/** Routine CRUD. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Routine, RoutineInput } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { trainingApi } from '../api';

export function useRoutines() {
  const { client } = useApi();
  return useQuery<Routine[]>({
    queryKey: queryKeys.routines,
    queryFn: () => trainingApi(client).routines(),
  });
}

export function useRoutineMutations() {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const api = trainingApi(client);

  // The overview surfaces the next routine, so it is invalidated alongside.
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.routines }),
      queryClient.invalidateQueries({ queryKey: queryKeys.overview }),
    ]);
  };

  return {
    create: useMutation({
      mutationFn: (input: RoutineInput) => api.createRoutine(input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<RoutineInput> }) =>
        api.updateRoutine(id, patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteRoutine(id),
      onSuccess: async () => {
        await invalidate();
        // History survives deletion, but its routineId is now null.
        await queryClient.invalidateQueries({ queryKey: queryKeys.workoutLogs });
      },
    }),
  };
}
