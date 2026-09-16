/**
 * Today's food log, and logging food.
 *
 * Logging is offline-capable, like workouts: the client id is minted here so a
 * queued write and any retry share one idempotency key.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FoodLogEntry, FoodLogInput } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { enqueue } from '@/shared/lib/offlineQueue';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { mintClientId } from '@/features/auth/state/onboardingStore';
import { nutritionApi } from '../api';

export function useDailyLog(date: string) {
  const { client } = useApi();
  return useQuery<FoodLogEntry[]>({
    queryKey: queryKeys.dailyLog(date),
    queryFn: () => nutritionApi(client).dailyLog(date),
  });
}

export function useLogFood(date: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();

  return useMutation<{ queued: boolean }, Error, Omit<FoodLogInput, 'clientId'>>({
    mutationFn: async (input) => {
      const payload: FoodLogInput = { ...input, clientId: mintClientId() };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enqueue('food-log', payload.clientId, payload);
        return { queued: true };
      }

      try {
        await nutritionApi(client).logFood(payload);
        return { queued: false };
      } catch (error) {
        if (error instanceof ApiRequestError && (error.isOffline || error.status >= 500)) {
          await enqueue('food-log', payload.clientId, payload);
          return { queued: true };
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dailyLog(date) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });
}

export function useDeleteLogEntry(date: string) {
  const { client } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => nutritionApi(client).deleteLogEntry(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dailyLog(date) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });
}
