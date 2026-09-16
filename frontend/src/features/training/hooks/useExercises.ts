/** Exercise library. Global reference data, so it is cached aggressively. */
import { useQuery } from '@tanstack/react-query';
import type { Exercise } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { trainingApi } from '../api';

export function useExercises(filter?: { muscleGroup?: string; q?: string }) {
  const { client } = useApi();
  const key = `${filter?.muscleGroup ?? ''}|${filter?.q ?? ''}`;

  return useQuery<Exercise[]>({
    queryKey: queryKeys.exercises(key),
    queryFn: () => trainingApi(client).exercises(filter),
    // The library changes only when the seed script runs, so an hour of
    // freshness avoids refetching 800 rows every time the tab is opened.
    staleTime: 60 * 60_000,
  });
}
