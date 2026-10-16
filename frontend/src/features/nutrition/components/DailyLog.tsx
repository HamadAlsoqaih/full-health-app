/**
 * Today's food log with running totals.
 *
 * Totals are computed from what is on screen rather than fetched separately, so
 * the number always matches the list beneath it — the alternative invites the
 * classic bug where a deleted entry disappears but the total does not move.
 */
import type { FoodLogEntry, MealSlot } from '@app/shared-types';
import { Card } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Skeleton } from '@/shared/components/Skeleton';
import { useToast } from '@/shared/components/Toast';
import { useDailyLog, useDeleteLogEntry } from '../hooks/useDailyLog';
import { useMe } from '@/features/auth/hooks/useAuth';
import { macroTargets } from '@/shared/lib/macroTargets';

const MEAL_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const SOURCE_LABEL: Record<FoodLogEntry['source'], string> = {
  usda: 'USDA',
  'open-food-facts': 'Open Food Facts',
  'ai-photo-estimate': 'Photo estimate',
  custom: 'Your food',
  manual: 'Manual',
};

export function DailyLog({ date }: { date: string }) {
  const toast = useToast();
  const log = useDailyLog(date);
  const remove = useDeleteLogEntry(date);
  const goals = useMe(true).data?.goals;

  if (log.isLoading) return <Skeleton lines={4} className="h-16 w-full" label="Loading log" />;
  if (log.isError) return <ErrorState error={log.error} onRetry={() => void log.refetch()} />;

  const entries = log.data ?? [];
  const targets =
    goals?.targetCalories !== undefined && goals.targetProteinG !== undefined
      ? macroTargets(goals.targetCalories, goals.targetProteinG)
      : undefined;

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing logged today"
        description="Search for a food, add one of your own, or scan a photo of your meal."
      />
    );
  }

  const totals = entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + entry.calories,
      proteinG: acc.proteinG + entry.proteinG,
      carbsG: acc.carbsG + entry.carbsG,
      fatG: acc.fatG + entry.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  // Grouped by meal, with anything unassigned collected at the end rather than
  // hidden.
  const grouped = MEAL_ORDER.map((meal) => ({
    meal: meal as MealSlot | 'other',
    entries: entries.filter((e) => e.meal === meal),
  })).concat([{ meal: 'other', entries: entries.filter((e) => !e.meal) }]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <dl className="flex flex-col gap-3">
          {(
            [
              ['Calories', totals.calories, goals?.targetCalories, 'kcal'],
              ['Protein', totals.proteinG, targets?.proteinG, 'g'],
              ['Carbs', totals.carbsG, targets?.carbsG, 'g'],
              ['Fat', totals.fatG, targets?.fatG, 'g'],
            ] as Array<[string, number, number | undefined, string]>
          ).map(([label, value, target, unit]) => {
            const logged = Math.round(value);
            const over = target !== undefined && logged > target;
            return (
              <div key={label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-sm text-text-muted">{label}</dt>
                  <dd className="text-sm text-text">
                    <span className="font-semibold">{logged}</span>
                    {target !== undefined ? (
                      <span className="text-text-muted">
                        {' '}
                        / {target} {unit}
                      </span>
                    ) : (
                      <span className="text-text-muted"> {unit}</span>
                    )}
                  </dd>
                </div>
                {target !== undefined && target > 0 ? (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className={`h-full rounded-full ${over ? 'bg-warning' : 'bg-accent'}`}
                      style={{ width: `${Math.min(100, (logged / target) * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </dl>
        {targets ? (
          <p className="mt-3 text-xs text-text-muted">
            Carbs and fat targets are worked out from your calorie and protein targets: fat is 25%
            of calories, carbs fill the rest.
          </p>
        ) : null}
      </Card>

      {grouped
        .filter((group) => group.entries.length > 0)
        .map((group) => (
          <section key={group.meal} className="flex flex-col gap-2">
            <h3 className="px-1 text-sm font-medium capitalize text-text-muted">
              {group.meal === 'other' ? 'Other' : group.meal}
            </h3>

            <ul className="flex flex-col gap-2">
              {group.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate font-medium text-text">{entry.foodName}</p>
                    <p className="truncate text-sm text-text-muted">
                      {entry.servingMultiplier === 1
                        ? entry.servingLabel
                        : `${entry.servingMultiplier} × ${entry.servingLabel}`}
                      {' · '}
                      {SOURCE_LABEL[entry.source]}
                    </p>
                  </div>

                  <span className="shrink-0 text-sm font-medium text-text">
                    {Math.round(entry.calories)} kcal
                  </span>

                  <button
                    type="button"
                    aria-label={`Remove ${entry.foodName}`}
                    onClick={() => {
                      void remove
                        .mutateAsync(entry.id)
                        .catch(() => toast.show('Could not remove that entry.', 'error'));
                    }}
                    className="flex size-touch shrink-0 items-center justify-center rounded-lg text-text-muted active:opacity-70"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
