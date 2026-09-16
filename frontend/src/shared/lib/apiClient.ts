/**
 * The single HTTP client.
 *
 * Two responsibilities beyond fetching:
 *
 * 1. **Refresh on 401, once.** The backend hands the session to the client, so
 *    supabase-js's own auto-refresh never runs and an access token simply expires
 *    after about an hour. Without the retry here, the app would appear to log the
 *    user out mid-session. The retry is attempted exactly once per request, and a
 *    concurrent burst of 401s shares a single refresh rather than firing one each.
 *
 * 2. **Normalise errors.** Every failure becomes an ApiRequestError carrying the
 *    server's stable `code`, so callers branch on that rather than on a message.
 */
import type { ApiError, ApiErrorCode, AuthSession } from '@app/shared-types';
import { config } from './config';

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  /** True when the request failed because the device has no usable connection. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

/**
 * The session holder.
 *
 * `subscribe` is not optional decoration: the router decides what to render from
 * whether a session exists, so a change has to trigger a re-render. Without it,
 * clearing the session after a failed refresh would leave the user on a dead
 * screen — the store would say "signed out" while React still showed the
 * signed-in tree.
 */
export interface SessionStore {
  get(): AuthSession | null;
  set(session: AuthSession | null): void;
  /** Registers a listener, returning an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** Wraps a plain get/set pair with listener support. */
function withSubscribers(
  read: () => AuthSession | null,
  write: (session: AuthSession | null) => void,
): SessionStore {
  const listeners = new Set<() => void>();
  // Cached so useSyncExternalStore's getSnapshot returns a stable reference and
  // does not loop: parsing JSON on every call would return a new object each time.
  let cached: AuthSession | null = read();

  return {
    get: () => cached,
    set(session) {
      write(session);
      cached = session;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Multipart, for the photo scan. Set instead of `body`. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Skips the Authorization header, for the auth endpoints. */
  anonymous?: boolean;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<void>;
}

export interface ApiClientOptions {
  sessions: SessionStore;
  fetchImpl?: typeof globalThis.fetch;
  baseUrl?: string;
  /** Called when refresh fails, so the app can route back to login. */
  onSessionExpired?: () => void;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? config.apiBaseUrl;
  const { sessions } = options;

  // Shared, so ten simultaneous 401s trigger one refresh rather than ten.
  let refreshInFlight: Promise<AuthSession | null> | null = null;

  async function parseError(response: Response): Promise<ApiRequestError> {
    let code: ApiErrorCode = 'INTERNAL';
    let message = `Request failed with status ${response.status}`;
    let details: Record<string, string[]> | undefined;

    try {
      const body = (await response.json()) as ApiError;
      if (body?.error) {
        code = body.error.code;
        message = body.error.message;
        details = body.error.details;
      }
    } catch {
      // A non-JSON error body (a proxy or gateway page) keeps the default above.
    }

    return new ApiRequestError(response.status, code, message, details);
  }

  async function refresh(): Promise<AuthSession | null> {
    refreshInFlight ??= (async () => {
      const current = sessions.get();
      if (!current?.refreshToken) return null;

      try {
        const response = await fetchImpl(`${baseUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!response.ok) return null;

        const body = (await response.json()) as { session: AuthSession };
        sessions.set(body.session);
        return body.session;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  }

  async function send(path: string, options_: RequestOptions, token: string | null) {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    // Content-Type is left unset for FormData so the browser adds the boundary.
    if (options_.body !== undefined) headers['Content-Type'] = 'application/json';

    return fetchImpl(`${baseUrl}${path}`, {
      method: options_.method ?? 'GET',
      headers,
      ...(options_.formData
        ? { body: options_.formData }
        : options_.body !== undefined
          ? { body: JSON.stringify(options_.body) }
          : {}),
      ...(options_.signal ? { signal: options_.signal } : {}),
    });
  }

  async function request<T>(path: string, options_: RequestOptions = {}): Promise<T> {
    const token = options_.anonymous ? null : (sessions.get()?.accessToken ?? null);

    let response: Response;
    try {
      response = await send(path, options_, token);
    } catch (error) {
      // A thrown fetch is a transport failure. Status 0 marks it as such so the UI
      // can say "you appear to be offline" rather than "something went wrong".
      throw new ApiRequestError(
        0,
        'INTERNAL',
        error instanceof Error && error.name === 'AbortError'
          ? 'Request cancelled.'
          : 'Could not reach the server. Check your connection.',
      );
    }

    // One refresh attempt, then one replay. Never a loop.
    if (response.status === 401 && !options_.anonymous) {
      const refreshed = await refresh();
      if (!refreshed) {
        sessions.set(null);
        options.onSessionExpired?.();
        throw await parseError(response);
      }
      response = await send(path, options_, refreshed.accessToken);
    }

    if (!response.ok) throw await parseError(response);

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    request,
    get: (path, signal) => request(path, signal ? { signal } : {}),
    post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    del: async (path) => {
      await request(path, { method: 'DELETE' });
    },
  };
}

/**
 * Session storage.
 *
 * localStorage keeps the user signed in across app launches, which is the
 * expected behaviour for a phone app. Every access is wrapped: in a private
 * window, or with site data blocked, the accessor itself can throw, and the app
 * must still run (signed out) rather than fail to start.
 */
const SESSION_KEY = 'fha.session.v1';

export const localSessionStore: SessionStore = withSubscribers(
  () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  },
  (session) => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignored: an unwritable store means the session lasts this tab only.
    }
  },
);

/** In-memory store, for tests and for a browser that refuses storage. */
export function createMemorySessionStore(initial: AuthSession | null = null): SessionStore {
  let current = initial;
  return withSubscribers(
    () => current,
    (session) => {
      current = session;
    },
  );
}
