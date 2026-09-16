/**
 * Mounts the real app against a stub fetch and an in-memory session.
 *
 * Nothing is mocked beyond the network boundary: the actual AppRouter, the actual
 * providers and the actual screens run, so these tests exercise the real
 * onboarding decision tree rather than a reimplementation of it.
 */
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { AuthSession, AuthUser } from '@app/shared-types';
import { ApiProvider } from '@/shared/lib/ApiProvider';
import { createMemorySessionStore } from '@/shared/lib/apiClient';
import { ToastProvider } from '@/shared/components/Toast';
import { AppRouter } from '@/routes/AppRouter';

export const SESSION: AuthSession = {
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token',
  expiresIn: 3600,
  expiresAt: 4_000_000_000,
};

export function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'a@example.com',
    units: 'metric',
    preferences: {
      notifications: { remindersEnabled: true, evaluationReadyEnabled: true },
      ai: { enabled: true, photoScanEnabled: true, evaluationEnabled: true },
    },
    onboarding: { goalsSubmitted: false, startingStatsSubmitted: false, complete: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export interface RecordedRequest {
  url: string;
  method: string;
  body: unknown;
}

export interface StubRoute {
  /** Matched as a substring of the URL. */
  match: string;
  method?: string;
  status?: number;
  /** Static body, or a function for a response that changes between calls. */
  response: unknown | (() => unknown);
}

/** A fetch that answers from a route table and records everything it was sent. */
export function stubFetch(routes: StubRoute[]) {
  const requests: RecordedRequest[] = [];

  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    requests.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const route = routes.find(
      (r) => url.includes(r.match) && (!r.method || r.method.toUpperCase() === method),
    );

    if (!route) {
      return new Response(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: `No stub for ${method} ${url}` },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body =
      typeof route.response === 'function' ? (route.response as () => unknown)() : route.response;

    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { impl: impl as unknown as typeof globalThis.fetch, requests };
}

export interface RenderAppOptions {
  session?: AuthSession | null;
  routes?: StubRoute[];
  initialPath?: string;
}

export function renderApp(options: RenderAppOptions = {}) {
  const { impl, requests } = stubFetch(options.routes ?? []);
  const sessions = createMemorySessionStore(options.session ?? null);

  // Retries off and no cache reuse: a test should see exactly one attempt.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider sessions={sessions} fetchImpl={impl} baseUrl="">
        <ToastProvider>
          <MemoryRouter initialEntries={[options.initialPath ?? '/']}>{children}</MemoryRouter>
        </ToastProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  const result = render(<AppRouter />, { wrapper });
  return { ...result, requests, sessions, queryClient };
}
