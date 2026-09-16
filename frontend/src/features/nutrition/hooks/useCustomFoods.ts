/**
 * The user's own foods.
 *
 * Cached for a long time and kept offline-capable: these are few, entirely
 * user-owned, and needed to log a meal without a connection.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomFood, CustomFoodInput } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { enqueue } from '@/shared/lib/offlineQueue';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { mintClientId } from '@/features/auth/state/onboardingStore';
import { nutritionApi } from '../api';

export function useCustomFoods() {
  const { client } = useApi();
  return useQuery<CustomFood[]>({
    queryKey: queryKeys.customFoods,
    queryFn: () => nutritionApi(client).customFoods(),
    // Long, because this list is what makes offline logging possible and it
    // changes only when the user adds something.
    staleTime: 10 * 60_000,
  });
}

export function useCreateCustomFood() {
  const { client } = useApi();
  const queryClient = useQueryClient();

  return useMutation<
    { queued: boolean; food?: CustomFood },
    Error,
    Omit<CustomFoodInput, 'clientId'>
  >({
    mutationFn: async (input) => {
      const payload: CustomFoodInput = { ...input, clientId: mintClientId() };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enqueue('custom-food', payload.clientId, payload);
        return { queued: true };
      }

      try {
        const food = await nutritionApi(client).createCustomFood(payload);
        return { queued: false, food };
      } catch (error) {
        if (error instanceof ApiRequestError && (error.isOffline || error.status >= 500)) {
          await enqueue('custom-food', payload.clientId, payload);
          return { queued: true };
        }
        throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.customFoods });
    },
  });
}
