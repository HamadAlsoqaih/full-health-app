/**
 * Targets for the weeks before a trend exists.
 *
 * With a body profile, maintenance comes from the Mifflin-St Jeor formula and
 * the user gets real targets from day one. Without one, the card says what to
 * fill in rather than showing nothing.
 */
import { Link } from 'react-router-dom';
import type { AuthUser, InsufficientTrendData } from '@app/shared-types';
import { Button, Card } from '@/shared/components/Field';
import { formulaMaintenance } from '@/shared/lib/maintenanceFormula';
import { startingTargets } from '../lib/onTrack';
import { useApplyTargets } from '../hooks/useApplyTargets';

export function StartingTargetsCard({
  user,
  weightKg,
  trend,
}: {
  user: AuthUser | undefined;
  weightKg: number | undefined;
  trend: InsufficientTrendData | undefined;
}) {
  const apply = useApplyTargets(user?.goals);

  const waterNote = trend?.earlyDaysSkippedUntil ? (
    <p className="text-xs text-text-muted">
      Your first two weeks of dieting don't count toward the measured trend: early loss is mostly
      water and stored carbohydrate, not fat, and would make your maintenance look far higher than
      it is. Measuring starts{' '}
      {new Date(`${trend.earlyDaysSkippedUntil}T00:00:00Z`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })}
      .
    </p>
  ) : null;

  if (!user?.body || weightKg === undefined) {
    return (
      <Card>
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-text-muted">Starting targets</h2>
          <p className="text-sm text-text">
            {weightKg === undefined
              ? 'Log a weigh-in to get starting calorie and macro targets.'
              : 'Add your height, birth year, sex and activity level to get calorie and macro targets now, instead of waiting for a few weeks of data.'}
          </p>
          {user?.body ? null : (
            <Link
              to="/app/settings"
              className="min-h-touch content-center text-sm font-medium text-accent active:opacity-70"
            >
              Add your body profile
            </Link>
          )}
          {waterNote}
        </div>
      </Card>
    );
  }

  const formula = formulaMaintenance(user.body, weightKg);
  const start = startingTargets(formula, weightKg, user.goals);
  const { targets } = start;
  const current = user.goals;
  const matches =
    current?.targetCalories !== undefined &&
    Math.abs(current.targetCalories - targets.calories) < 50 &&
    current.targetProteinG === targets.proteinG;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-text-muted">Starting targets</h2>
          <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-text-muted">
            Estimated
          </span>
        </div>
        <p className="text-sm text-text">
          Until your own trend can measure it, your maintenance is estimated from a formula at{' '}
          <span className="font-medium">{formula} kcal</span> a day. For about 1 in 4 people it's
          off by more than 10%, so the app switches to your measured numbers as your data builds up.
        </p>
        <dl className="grid grid-cols-4 gap-2 rounded-lg bg-surface-raised p-3 text-center">
          {(
            [
              ['kcal', targets.calories],
              ['Protein', `${targets.proteinG} g`],
              ['Carbs', `${targets.carbsG} g`],
              ['Fat', `${targets.fatG} g`],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="font-medium text-text">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-text-muted">
          {formula} kcal maintenance {start.targetRateKgPerWeek < 0 ? '−' : '+'}{' '}
          {Math.abs(start.targetRateKgPerWeek)} kg/week × 7700 ÷ 7. Mifflin-St Jeor formula with
          your activity level; edit it in Settings.
        </p>
        {waterNote}
        {matches ? (
          <p className="text-sm font-medium text-success">These are already your targets.</p>
        ) : (
          <Button loading={apply.isPending} onClick={() => apply.mutate(targets)}>
            Use these targets
          </Button>
        )}
      </div>
    </Card>
  );
}
