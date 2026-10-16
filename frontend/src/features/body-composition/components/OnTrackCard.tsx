/**
 * "Are you on track?" — the verdict, this week's targets, and where they lead.
 *
 * Shows the saved target, what is actually eaten and this week's step side by
 * side, with the goal the weekly steps are heading for underneath. Nothing
 * changes until the user adopts the suggestion.
 */
import type { AuthUser, BodyMeasurement, ComputedTrend, Goals } from '@app/shared-types';
import { Button, Card } from '@/shared/components/Field';
import { formulaMaintenance } from '@/shared/lib/maintenanceFormula';
import {
  bodyInsights,
  loggingReliability,
  onTrackVerdict,
  type Insight,
  type OnTrackStatus,
  type Reliability,
} from '../lib/onTrack';
import { useApplyTargets } from '../hooks/useApplyTargets';

const BADGE: Record<OnTrackStatus, string> = {
  'on-track': 'border-success text-success',
  'too-fast': 'border-warning text-warning',
  'too-slow': 'border-warning text-warning',
  'wrong-way': 'border-danger text-danger',
};

const INSIGHT_TONE: Record<Insight['tone'], string> = {
  good: 'border-success text-text',
  warn: 'border-warning text-text',
  info: 'border-border text-text',
};

const RELIABILITY: Record<Reliability, { label: string; className: string }> = {
  high: { label: 'High', className: 'text-success' },
  medium: { label: 'Medium', className: 'text-warning' },
  low: { label: 'Low', className: 'text-danger' },
};

const ROWS = [
  ['Calories', 'calories', 'kcal'],
  ['Protein', 'proteinG', 'g'],
  ['Carbs', 'carbsG', 'g'],
  ['Fat', 'fatG', 'g'],
] as const;

export function OnTrackCard({
  trend,
  user,
  measurements,
}: {
  trend: ComputedTrend;
  user: AuthUser | undefined;
  measurements: BodyMeasurement[];
}) {
  const goals: Goals | undefined = user?.goals;
  const formula = user?.body ? formulaMaintenance(user.body, trend.endWeightKg) : undefined;
  const verdict = onTrackVerdict(
    trend,
    goals,
    formula !== undefined ? { formulaMaintenance: formula } : {},
  );
  const reliability = loggingReliability(trend, formula, verdict.measuredMaintenanceCalories);
  // Targets built on logs that are missing food would be wrong; hold them.
  const hold = reliability.underLogging;
  const insights = hold ? [] : bodyInsights(trend, measurements, verdict);
  const thisWeek = hold && verdict.current ? verdict.current : verdict.suggested;
  const apply = useApplyTargets(goals);

  const source =
    formula === undefined || verdict.blendWeight >= 1
      ? `measured from your last ${trend.days} days`
      : `${Math.round(verdict.blendWeight * 100)}% measured and ${Math.round((1 - verdict.blendWeight) * 100)}% formula, since your trend is only ${trend.days} days old`;

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
          {hold
            ? `Your weight is changing at ${trend.ratePerWeekKg} kg/week against a plan of ${verdict.targetRateKgPerWeek}. But your logs are missing food, so what you log isn't what you eat: keep your current target instead of eating to your logs.`
            : insights.some((i) => i.id === 'recomp')
              ? "Your weight is flat, but your waist says you're losing fat, so this is working. If you also want the scale to move, the suggestion below gets you to your planned rate."
              : verdict.detail}
        </p>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-text-muted">
              <th className="py-1 text-left font-normal">Daily</th>
              <th className="py-1 text-right font-normal">Target</th>
              <th className="py-1 text-right font-normal">You eat</th>
              <th className="py-1 text-right font-normal">{hold ? 'Keep' : 'This week'}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, key, unit]) => {
              const now = verdict.current?.[key];
              const next = thisWeek[key];
              const eaten =
                key === 'calories'
                  ? trend.avgDailyCalories
                  : key === 'proteinG'
                    ? trend.avgDailyProteinG
                    : undefined;
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

        {hold ? (
          <p className="rounded-lg border border-warning p-3 text-sm text-text">
            <span className="font-medium">Fix logging before changing targets.</span> Your logs
            don't add up (see below), so new targets would be built on food that isn't there. For
            the next two weeks log everything, including oil, drinks, sauces and bites, then check
            back.
          </p>
        ) : verdict.status !== 'on-track' ? (
          <p className="rounded-lg bg-surface-raised p-3 text-sm text-text">
            <span className="font-medium">
              Goal: {verdict.goal.calories} ± {reliability.rangeKcal} kcal a day
            </span>
            {verdict.weeksToGoal > 1
              ? `, reached in ${verdict.weeksToGoal} weekly steps of up to 500 kcal. Each step starts from what you actually eat (${trend.avgDailyCalories} kcal), not your saved target, because a big overnight change is hard to stick with.`
              : ', reached this week.'}
          </p>
        ) : null}

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

        <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
          <p className="text-sm text-text">
            Logging reliability:{' '}
            <span className={`font-medium ${RELIABILITY[reliability.level].className}`}>
              {RELIABILITY[reliability.level].label}
            </span>
          </p>
          {reliability.reasons.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-text-muted">
              {reliability.reasons.map((reason) => (
                <li key={reason}>· {reason}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-muted">
              {formula !== undefined
                ? 'No partial days, no weekend gaps, and your numbers line up with the formula.'
                : 'No partial days and no weekend gaps.'}
            </p>
          )}
        </div>

        <p className="text-xs text-text-muted">
          Maintenance is {verdict.maintenanceCalories} kcal, {source}. Measured ={' '}
          {trend.avgDailyCalories} eaten {trend.ratePerWeekKg <= 0 ? '+' : '−'}{' '}
          {Math.abs(trend.ratePerWeekKg)} kg/week {trend.ratePerWeekKg <= 0 ? 'lost' : 'gained'} ×
          7700 ÷ 7 = {verdict.measuredMaintenanceCalories} kcal
          {formula !== undefined ? `; formula = ${formula} kcal` : ''}.
          {trend.earlyDaysSkippedUntil
            ? ' Your first two weeks of dieting are left out, because early loss is mostly water.'
            : ''}{' '}
          Protein is 1.6–2.2 g/kg (1.8 if your target is outside that); fat is at least 0.8 g/kg and
          carbs fill the rest.
        </p>

        {hold ? null : verdict.shouldChange ? (
          <Button loading={apply.isPending} onClick={() => apply.mutate(verdict.suggested)}>
            Use this week's targets
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
