/**
 * The plain-language check-in.
 *
 * The important property: the deterministic numbers and recommendation are shown
 * ALWAYS, and the AI prose is an optional layer on top. So a user whose evaluation
 * is pending, failed, or who has AI switched off entirely still gets the complete
 * analysis — they just do not get it phrased in sentences.
 *
 * That is why `trend` is returned alongside every evaluation status rather than
 * only when the summary is ready.
 */
import type { BodyCompEvaluation, TrendResult, UnitSystem } from '@app/shared-types';
import { Card } from '@/shared/components/Field';
import { formatWeightChange } from '@/shared/lib/units';

const ACTION_LABEL: Record<string, string> = {
  'increase-calories': 'Eat more',
  'reduce-calories': 'Eat less',
  'hold-calories': 'Keep intake where it is',
  'increase-protein': 'Raise your protein',
  'log-more-consistently': 'Log more consistently',
};

function Recommendation({ trend, units }: { trend: TrendResult; units: UnitSystem }) {
  if (trend.status !== 'ok') {
    const needed = trend.daysNeeded;
    return (
      <div className="flex flex-col gap-2">
        <p className="font-medium text-text">Not enough data yet</p>
        <p className="text-sm text-text-muted">
          {needed > 0
            ? `Keep logging for about ${needed} more ${needed === 1 ? 'day' : 'days'} and a trend will appear.`
            : 'Keep logging your weight and meals and a trend will appear.'}
        </p>
        <ul className="flex flex-col gap-1 text-sm text-text-muted">
          {trend.reasons.includes('not-enough-weight-entries') ? (
            <li>· More weigh-ins ({trend.weightEntryCount} so far)</li>
          ) : null}
          {trend.reasons.includes('not-enough-food-logs') ? (
            <li>· More logged food days ({trend.daysWithFoodLogs} so far)</li>
          ) : null}
          {trend.reasons.includes('span-too-short') ? <li>· A longer stretch of entries</li> : null}
        </ul>
      </div>
    );
  }

  const { recommendation } = trend;
  const delta = recommendation.calorieDeltaPerDay;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-text">
          {ACTION_LABEL[recommendation.action] ?? 'Keep going'}
          {delta !== 0 ? (
            <span className="font-normal text-text-muted">
              {' '}
              — about {Math.abs(delta)} kcal/day {delta > 0 ? 'more' : 'less'}
            </span>
          ) : null}
        </p>
        <p className="text-sm text-text-muted">{recommendation.rationale}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-raised p-3">
        {[
          ['Change', formatWeightChange(trend.weightChangeKg, units)],
          ['Per week', formatWeightChange(trend.ratePerWeekKg, units)],
          ['Avg intake', `${trend.avgDailyCalories} kcal`],
          ['Est. maintenance', `${trend.estimatedMaintenanceCalories} kcal`],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>

      {recommendation.proteinTargetG ? (
        <p className="text-sm text-text-muted">
          Aim for around {recommendation.proteinTargetG} g of protein a day.
        </p>
      ) : null}

      <p className="text-xs text-text-muted">
        These figures are calculated from your own logs. They are not medical advice.
      </p>
    </div>
  );
}

export function AiEvaluation({
  evaluation,
  trend,
  units,
}: {
  evaluation: BodyCompEvaluation | undefined;
  trend: TrendResult | undefined;
  units: UnitSystem;
}) {
  // Prefer the trend carried with the evaluation, so the prose and the numbers
  // describe the same window.
  const effectiveTrend = evaluation?.trend ?? trend;

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-text-muted">Your check-in</h2>

        {evaluation?.status === 'ready' && evaluation.summary ? (
          <p className="text-base text-text">{evaluation.summary}</p>
        ) : null}

        {evaluation?.status === 'pending' ? (
          <p role="status" aria-live="polite" className="text-sm text-text-muted">
            Writing your summary… the numbers below are already final.
          </p>
        ) : null}

        {evaluation?.status === 'failed' ? (
          <p className="text-sm text-text-muted">
            The written summary could not be generated this time. The analysis below is unaffected.
          </p>
        ) : null}

        {/* Always rendered, whatever the AI did. */}
        {effectiveTrend ? <Recommendation trend={effectiveTrend} units={units} /> : null}
      </div>
    </Card>
  );
}
