/**
 * "Are you on track?" — the verdict, and the targets to change to if not.
 *
 * Shows current and suggested targets side by side so the change is visible, and
 * lets the user adopt the suggestion in one tap. Nothing changes until they do.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthUser, BodyMeasurement, ComputedTrend, Goals } from '@app/shared-types';
import { Button, Card } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { authApi } from '@/features/auth/api';
import { bodyInsights, onTrackVerdict, type Insight, type OnTrackStatus } from '../lib/onTrack';

const INSIGHT_TONE: Record<Insight['tone'], string> = {
  good: 'border-success text-text',
  warn: 'border-warning text-text',
  info: 'border-border text-text',
};

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

export function OnTrackCard({
  trend,
  goals,
  measurements,
}: {
  trend: ComputedTrend;
  goals: Goals | undefined;
  measurements: BodyMeasurement[];
}) {
  const { client } = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const verdict = onTrackVerdict(trend, goals);
  const insights = bodyInsights(trend, measurements, verdict);

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

        <p className="text-sm text-text">
          {insights.some((i) => i.id === 'recomp')
            ? "Your weight is flat, but your waist says you're losing fat, so this is working. If you also want the scale to move, the suggestion below gets you to your planned rate."
            : verdict.detail}
        </p>

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

        {insights.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {insights.map((insight) => (
              <li
                key={insight.id}
                className={`border-l-2 pl-3 text-sm ${INSIGHT_TONE[insight.tone]}`}
              >
                {insight.text}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs text-text-muted">
          {verdict.status === 'on-track'
            ? 'Suggested calories are what you already eat, since that is producing your planned rate.'
            : `Suggested calories are your maintenance (${verdict.maintenanceCalories} kcal = ${trend.avgDailyCalories} eaten ${trend.ratePerWeekKg <= 0 ? '+' : '−'} ${Math.abs(trend.ratePerWeekKg)} kg/week ${trend.ratePerWeekKg <= 0 ? 'lost' : 'gained'} × 7700 ÷ 7) adjusted for your planned ${verdict.targetRateKgPerWeek} kg/week.`}{' '}
          Protein is 1.6–2.2 g per kg of body weight (1.8 if your target is outside that); fat is at
          least 0.8 g/kg and carbs fill the rest. "You eat" is your average on logged days.
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
