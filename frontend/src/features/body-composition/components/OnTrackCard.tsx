/**
 * "Are you on track?" — the verdict, and the targets to change to if not.
 *
 * Shows current and suggested targets side by side so the change is visible, and
 * lets the user adopt the suggestion in one tap. Nothing changes until they do.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthUser, ComputedTrend, Goals } from '@app/shared-types';
import { Button, Card } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { authApi } from '@/features/auth/api';
import { onTrackVerdict, type OnTrackStatus } from '../lib/onTrack';

const BADGE: Record<OnTrackStatus, string> = {
  'on-track': 'border-success text-success',
  'too-fast': 'border-warning text-warning',
  'too-slow': 'border-warning text-warning',
  'wrong-way': 'border-danger text-danger',
};

const ROWS = [
  ['Calories', 'calories', 'kcal'],
  ['Protein', 'proteinG', 'g'],
  ['Carbs', 'carbsG', 'g'],
  ['Fat', 'fatG', 'g'],
] as const;

export function OnTrackCard({ trend, goals }: { trend: ComputedTrend; goals: Goals | undefined }) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const verdict = onTrackVerdict(trend, goals);

  const apply = useMutation({
    mutationFn: () =>
      authApi(client).updateMe({
        goals: {
          goal: goals?.goal ?? 'maintain',
          ...goals,
          targetCalories: verdict.suggested.calories,
          targetProteinG: verdict.suggested.proteinG,
        },
      }),
    onSuccess: (user: AuthUser) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      toast.show('Targets updated.', 'success');
    },
    onError: () => toast.show('Could not update your targets.', 'error'),
  });

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-text-muted">Are you on track?</h2>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE[verdict.status]}`}
          >
            {verdict.title}
          </span>
        </div>

        <p className="text-sm text-text">{verdict.detail}</p>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-text-muted">
              <th className="py-1 text-left font-normal">Daily</th>
              <th className="py-1 text-right font-normal">Target</th>
              <th className="py-1 text-right font-normal">You eat</th>
              <th className="py-1 text-right font-normal">Suggested</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, key, unit]) => {
              const now = verdict.current?.[key];
              const eaten =
                key === 'calories'
                  ? trend.avgDailyCalories
                  : key === 'proteinG'
                    ? trend.avgDailyProteinG
                    : undefined;
              const next = verdict.suggested[key];
              const changed =
                now === undefined || Math.abs(now - next) >= (key === 'calories' ? 50 : 1);
              return (
                <tr key={key} className="border-t border-border">
                  <td className="py-1.5 text-text-muted">{label}</td>
                  <td className="py-1.5 text-right text-text">
                    {now === undefined ? '—' : `${now} ${unit}`}
                  </td>
                  <td className="py-1.5 text-right text-text-muted">
                    {eaten === undefined ? '—' : `${eaten} ${unit}`}
                  </td>
                  <td
                    className={`py-1.5 text-right font-medium ${changed ? 'text-accent' : 'text-text'}`}
                  >
                    {next} {unit}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {verdict.status !== 'on-track' &&
        verdict.current &&
        Math.abs(trend.avgDailyCalories - verdict.current.calories) > 150 ? (
          <p className="text-sm text-warning">
            You're eating about {Math.abs(trend.avgDailyCalories - verdict.current.calories)} kcal a
            day {trend.avgDailyCalories > verdict.current.calories ? 'over' : 'under'} your target.
            Hitting the target matters as much as the target itself.
          </p>
        ) : null}

        <p className="text-xs text-text-muted">
          {verdict.status === 'on-track'
            ? 'Suggested calories are what you already eat, since that is producing your planned rate.'
            : `Suggested calories are your estimated maintenance (${trend.estimatedMaintenanceCalories} kcal) adjusted for your planned ${verdict.targetRateKgPerWeek} kg/week.`}{' '}
          Protein is at least 1.6 g per kg of body weight; fat is 25% of calories and carbs fill the
          rest. "You eat" is your average on logged days.
        </p>

        {verdict.shouldChange ? (
          <Button loading={apply.isPending} onClick={() => apply.mutate()}>
            Use suggested targets
          </Button>
        ) : (
          <p className="text-sm font-medium text-success">
            Your targets already match. No change needed.
          </p>
        )}
      </div>
    </Card>
  );
}
