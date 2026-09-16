/**
 * Workout history, and logging a completed workout.
 *
 * Logging is offline-capable: if the device has no connection — a gym basement is
 * the canonical case — the write goes to the IndexedDB outbox and syncs later. The
 * client id is minted here so the queued write and any retry share one idempotency
 * key and cannot produce two logs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkoutLog, WorkoutLogInput } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { enqueue } from '@/shared/lib/offlineQueue';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { mintClientId } from '@/features/auth/state/onboardingStore';
import { trainingApi } from '../api';

export function useWorkoutLogs() {
  const { client } = useApi();
  return useQuery<WorkoutLog[]>({
    queryKey: queryKeys.workoutLogs,
    queryFn: () => trainingApi(client).workoutLogs(),
  });
}

export interface LogWorkoutResult {
  queued: boolean;
}

export function useLogWorkout() {
  const { client } = useApi();
  const queryClient = useQueryClient();

  return useMutation<LogWorkoutResult, Error, Omit<WorkoutLogInput, 'clientId'>>({
    mutationFn: async (input) => {
      const payload: WorkoutLogInput = { ...input, clientId: mintClientId() };

      // Offline by the browser's own reckoning: queue without attempting.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enqueue('workout-log', payload.clientId, payload);
        return { queued: true };
      }

      try {
        await trainingApi(client).logWorkout(payload);
        return { queued: false };
      } catch (error) {
        // A transport failure means the request never landed, so queueing it is
        // safe. A 4xx means the payload is wrong and queueing would only retry a
        // rejection forever.
        if (error instanceof ApiRequestError && (error.isOffline || error.status >= 500)) {
          await enqueue('workout-log', payload.clientId, payload);
          return { queued: true };
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workoutLogs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });
}
