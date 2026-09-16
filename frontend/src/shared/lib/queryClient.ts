/**
 * TanStack Query defaults, tuned for a phone on unreliable mobile data.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from './apiClient';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A minute of freshness avoids a refetch storm as the user moves between
        // the five tabs, without showing meaningfully stale numbers.
        staleTime: 60_000,
        gcTime: 15 * 60_000,
        // Refetching on focus matters more here than on desktop: the app is
        // backgrounded constantly, and data may have synced from another device.
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // A 4xx will not become a 2xx by asking again; only transport and 5xx
          // failures are worth retrying.
          if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // Never retried automatically: writes that can be queued go through the
        // offline outbox, which owns retrying with an idempotency key. A blind
        // retry here could duplicate a write that has no such key.
        retry: false,
      },
    },
  });
}

/** Query keys in one place, so an invalidation cannot miss a consumer. */
export const queryKeys = {
  me: ['me'] as const,
  /** Prefix. Invalidating this reaches every day's summary. */
  overview: ['overview'] as const,
  overviewFor: (date: string) => ['overview', date] as const,
  exercises: (filter?: string) => ['exercises', filter ?? 'all'] as const,
  routines: ['routines'] as const,
  workoutLogs: ['workout-logs'] as const,
  customFoods: ['custom-foods'] as const,
  foodSearch: (query: string) => ['food-search', query] as const,
  dailyLog: (date: string) => ['daily-log', date] as const,
  measurements: ['measurements'] as const,
  trend: (days: number) => ['trend', days] as const,
  evaluation: ['evaluation'] as const,
  billing: ['billing'] as const,
} as const;
