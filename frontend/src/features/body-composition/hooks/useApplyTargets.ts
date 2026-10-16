/** Saves suggested calorie and protein targets onto the user's goals. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthUser, Goals } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { useToast } from '@/shared/components/Toast';
import { authApi } from '@/features/auth/api';
import type { MacroTargets } from '@/shared/lib/macroTargets';

export function useApplyTargets(goals: Goals | undefined) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (targets: MacroTargets) =>
      authApi(client).updateMe({
        goals: {
          goal: goals?.goal ?? 'maintain',
          ...goals,
          targetCalories: targets.calories,
          targetProteinG: targets.proteinG,
        },
      }),
    onSuccess: (user: AuthUser) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      toast.show('Targets updated.', 'success');
    },
    onError: () => toast.show('Could not update your targets.', 'error'),
  });
}
