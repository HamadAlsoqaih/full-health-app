/**
 * Provides the API client and session store to the tree.
 *
 * Both are injected rather than imported as singletons, which is what lets a test
 * mount the real components against a stub fetch and an in-memory session.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { createApiClient, localSessionStore, type ApiClient, type SessionStore } from './apiClient';

interface ApiContextValue {
  client: ApiClient;
  sessions: SessionStore;
  /**
   * True when a request failed with 401 AND the refresh could not recover it.
   *
   * Owned here because the API client is what detects it: by the time a failed
   * query surfaces to a component, the client has already cleared the session, so
   * a component cannot tell an expiry apart from an ordinary sign-out. The router
   * needs that distinction to send a returning user to login rather than back
   * through onboarding.
   */
  sessionExpired: boolean;
  acknowledgeSessionExpiry(): void;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export interface ApiProviderProps {
  children: ReactNode;
  sessions?: SessionStore;
  fetchImpl?: typeof globalThis.fetch;
  baseUrl?: string;
  onSessionExpired?: () => void;
}

export function ApiProvider({
  children,
  sessions = localSessionStore,
  fetchImpl,
  baseUrl,
  onSessionExpired,
}: ApiProviderProps) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const acknowledgeSessionExpiry = useCallback(() => setSessionExpired(false), []);

  const client = useMemo(
    () =>
      createApiClient({
        sessions,
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        onSessionExpired: () => {
          setSessionExpired(true);
          onSessionExpired?.();
        },
      }),
    [sessions, fetchImpl, baseUrl, onSessionExpired],
  );

  const value = useMemo<ApiContextValue>(
    () => ({ sessions, client, sessionExpired, acknowledgeSessionExpiry }),
    [sessions, client, sessionExpired, acknowledgeSessionExpiry],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiContextValue {
  const context = useContext(ApiContext);
  if (!context) throw new Error('useApi must be used inside ApiProvider');
  return context;
}

/**
 * Subscribes to the session.
 *
 * The router renders a completely different tree depending on whether a session
 * exists, so it must re-render when that changes — after a login, a logout, or a
 * refresh that failed. Reading the store directly would not re-render, leaving
 * the user looking at a signed-in screen with no session behind it.
 */
export function useSession() {
  const { sessions } = useApi();
  return useSyncExternalStore(
    (listener) => sessions.subscribe(listener),
    () => sessions.get(),
    () => sessions.get(),
  );
}
