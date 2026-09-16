/**
 * Today's snapshot: calories against target, the next routine, the body-comp trend.
 *
 * Reads exactly one endpoint and imports no other feature's api module (spec
 * rule 5). Beyond the architectural rule, that is what makes the numbers on this
 * screen mutually consistent — five separate requests would produce a snapshot
 * assembled from five different moments.
 */
import { Link } from 'react-router-dom';
import type { OverviewSummary } from '@app/shared-types';
import { Card, Screen } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonCard } from '@/shared/components/Skeleton';
import { useMe } from '@/features/auth/hooks/useAuth';
import { formatWeight, formatWeightChange } from '@/shared/lib/units';
import { useOverview } from '../hooks/useOverview';

function CaloriesCard({ summary }: { summary: OverviewSummary }) {
  const { logged, target, remaining } = summary.calories;
  const pct = target && target > 0 ? Math.min(100, (logged / target) * 100) : null;
  const over = remaining !== undefined && remaining < 0;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-text-muted">Calories today</h2>
          {target ? (
            <span className={`text-sm font-medium ${over ? 'text-warning' : 'text-text-muted'}`}>
              {over ? `${Math.abs(remaining ?? 0)} over` : `${remaining} left`}
            </span>
          ) : null}
        </div>

        <p className="text-3xl font-semibold text-text">
          {Math.round(logged)}
          {target ? (
            <span className="text-base font-normal text-text-muted"> / {target} kcal</span>
          ) : (
            <span className="text-base font-normal text-text-muted"> kcal</span>
          )}
        </p>

        {pct !== null ? (
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Calories logged against target"
          >
            <div
              className={`h-full rounded-full ${over ? 'bg-warning' : 'bg-accent'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : (
          <p className="text-xs text-text-muted">
            Set a calorie target in Settings to track against it.
          </p>
        )}

        <dl className="flex gap-4 text-sm">
          {[
            ['Protein', summary.macros.proteinG, summary.macros.proteinTargetG],
            ['Carbs', summary.macros.carbsG, undefined],
            ['Fat', summary.macros.fatG, undefined],
          ].map(([label, value, goal]) => (
            <div key={label as string} className="flex flex-col">
              <dt className="text-xs text-text-muted">{label as string}</dt>
              <dd className="font-medium text-text">
                {Math.round(value as number)}
                {goal ? <span className="text-text-muted">/{goal as number}</span> : null} g
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function TrendCard({ summary, units }: { summary: OverviewSummary; units: 'metric' | 'imperial' }) {
  const body = summary.bodyComposition;
  if (!body) return null;

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-text-muted">Body composition</h2>
        <p className="text-2xl font-semibold text-text">
          {formatWeight(body.latestWeightKg, units)}
        </p>
        {body.weightChangeKg !== undefined ? (
          <p className="text-sm text-text-muted">
            {formatWeightChange(body.weightChangeKg, units)} over the last 30 days
            {body.ratePerWeekKg !== undefined
              ? ` · ${formatWeightChange(body.ratePerWeekKg, units)}/week`
              : ''}
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            Keep logging — a trend needs about two weeks of weight and food entries.
          </p>
        )}
        <Link
          to="/app/body"
          className="mt-1 min-h-touch text-sm font-medium text-accent active:opacity-70"
        >
          See the full trend
        </Link>
      </div>
    </Card>
  );
}

export function OverviewDashboard() {
  const overview = useOverview();
  const me = useMe(true);
  const units = me.data?.units ?? 'metric';

  if (overview.isLoading) {
    return (
      <Screen title="Today">
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={4} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </div>
      </Screen>
    );
  }

  if (overview.isError) {
    return (
      <Screen title="Today">
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      </Screen>
    );
  }

  const summary = overview.data;
  if (!summary) return null;

  const isBrandNew =
    summary.calories.logged === 0 && !summary.bodyComposition && !summary.lastWorkout;

  return (
    <Screen title="Today">
      <div className="flex flex-col gap-4">
        {isBrandNew ? (
          <Card>
            <EmptyState
              title="Nothing logged yet"
              description="Log a meal or finish a workout and this screen fills in."
            />
          </Card>
        ) : null}

        <CaloriesCard summary={summary} />

        {summary.nextRoutine ? (
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <h2 className="text-sm font-medium text-text-muted">Next routine</h2>
                <p className="text-lg font-semibold text-text">{summary.nextRoutine.name}</p>
                <p className="text-sm text-text-muted">
                  {summary.nextRoutine.exerciseCount} exercises
                </p>
              </div>
              <Link
                to="/app/training"
                className="flex min-h-touch items-center rounded-lg bg-accent px-4 font-medium text-accent-text active:opacity-80"
              >
                Start
              </Link>
            </div>
          </Card>
        ) : null}

        <TrendCard summary={summary} units={units} />

        {summary.lastWorkout ? (
          <Card>
            <h2 className="text-sm font-medium text-text-muted">Last workout</h2>
            <p className="mt-1 font-medium text-text">{summary.lastWorkout.routineName}</p>
            <p className="text-sm text-text-muted">
              {new Date(summary.lastWorkout.completedAt).toLocaleDateString()}
            </p>
          </Card>
        ) : null}

        {summary.evaluation.status === 'pending' ? (
          <p className="px-1 text-xs text-text-muted">
            Your latest check-in summary is being prepared.
          </p>
        ) : null}
      </div>
    </Screen>
  );
}
