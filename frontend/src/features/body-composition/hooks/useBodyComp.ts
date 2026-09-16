/**
 * Body-composition data: entries, the deterministic trend, and the AI evaluation.
 *
 * The evaluation query polls while pending. The interval is deliberately not
 * aggressive: the server re-fires a stale job on read, so each poll can do real
 * work, and a tight loop would hammer a free-tier instance for a result that
 * takes seconds.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BodyCompEvaluation,
  BodyMeasurement,
  BodyMeasurementInput,
  TrendResult,
} from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { enqueue } from '@/shared/lib/offlineQueue';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { mintClientId } from '@/features/auth/state/onboardingStore';
import { bodyCompositionApi } from '../api';

export function useMeasurements() {
  const { client } = useApi();
  return useQuery<BodyMeasurement[]>({
    queryKey: queryKeys.measurements,
    queryFn: () => bodyCompositionApi(client).list(),
  });
}

export function useTrend(days = 30) {
  const { client } = useApi();
  return useQuery<TrendResult>({
    queryKey: queryKeys.trend(days),
    queryFn: () => bodyCompositionApi(client).trend(days),
  });
}

export function useEvaluation() {
  const { client } = useApi();
  return useQuery<BodyCompEvaluation>({
    queryKey: queryKeys.evaluation,
    queryFn: () => bodyCompositionApi(client).evaluation(),
    refetchInterval: (query) =>
      // Only while there is something to wait for.
      query.state.data?.status === 'pending' ? 10_000 : false,
  });
}

export function useRecordMeasurement() {
  const { client } = useApi();
  const queryClient = useQueryClient();

  return useMutation<{ queued: boolean }, Error, Omit<BodyMeasurementInput, 'clientId'>>({
    mutationFn: async (input) => {
      const payload: BodyMeasurementInput = { ...input, clientId: mintClientId() };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await enqueue('body-measurement', payload.clientId, payload);
        return { queued: true };
      }

      try {
        await bodyCompositionApi(client).createEntry(payload);
        return { queued: false };
      } catch (error) {
        if (error instanceof ApiRequestError && (error.isOffline || error.status >= 500)) {
          await enqueue('body-measurement', payload.clientId, payload);
          return { queued: true };
        }
        throw error;
      }
    },
    onSuccess: async () => {
      // A new measurement changes the trend and may start an evaluation.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.measurements }),
        queryClient.invalidateQueries({ queryKey: ['trend'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.evaluation }),
        queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
      ]);
    },
  });
}
