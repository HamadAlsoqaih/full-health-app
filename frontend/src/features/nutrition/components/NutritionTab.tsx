/**
 * Nutrition tab: today's log, search, own foods, and the photo scan.
 *
 * Search, custom foods and the log all work offline. The photo scan cannot — it
 * needs the model — so it is presented as its own action rather than mixed in with
 * the paths that keep working without a connection.
 */
import { useState } from 'react';
import { Button, Card, Screen } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { Skeleton } from '@/shared/components/Skeleton';
import { useCustomFoods } from '../hooks/useCustomFoods';
import { todayIso } from '@/shared/lib/dates';
import { CustomFoodForm } from './CustomFoodForm';
import { DailyLog } from './DailyLog';
import { FoodSearch } from './FoodSearch';
import { PhotoScan } from './PhotoScan';

type View = 'log' | 'search' | 'scan' | 'custom-list' | 'custom-new';

export function NutritionTab() {
  const [view, setView] = useState<View>('log');
  const date = todayIso();
  const customFoods = useCustomFoods();

  if (view === 'scan') {
    return (
      <Screen>
        <div className="py-4">
          <PhotoScan onDone={() => setView('log')} />
        </div>
      </Screen>
    );
  }

  if (view === 'search') {
    return (
      <Screen title="Add food">
        <div className="flex flex-col gap-4">
          <FoodSearch onLogged={() => setView('log')} />
          <Button variant="ghost" onClick={() => setView('log')}>
            Back to today
          </Button>
        </div>
      </Screen>
    );
  }

  if (view === 'custom-new') {
    return (
      <Screen title="New food">
        <CustomFoodForm onDone={() => setView('custom-list')} />
      </Screen>
    );
  }

  if (view === 'custom-list') {
    return (
      <Screen title="Your foods">
        <div className="flex flex-col gap-4">
          <Button onClick={() => setView('custom-new')}>Add a food</Button>

          {customFoods.isLoading ? (
            <Skeleton lines={4} className="h-16 w-full" label="Loading your foods" />
          ) : (customFoods.data ?? []).length === 0 ? (
            <EmptyState
              title="No foods of your own yet"
              description="Add the things you eat often. They are kept on this device too, so you can log them offline."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {(customFoods.data ?? []).map((food) => (
                <li
                  key={food.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex min-w-0 flex-col">
                    <p className="truncate font-medium text-text">{food.name}</p>
                    <p className="truncate text-sm text-text-muted">
                      {food.servingLabel} · {Math.round(food.proteinG)}g protein
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-medium text-text">
                    {Math.round(food.calories)} kcal
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Button variant="ghost" onClick={() => setView('log')}>
            Back to today
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Nutrition">
      <div className="flex flex-col gap-4">
        <Card>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-text-muted">Add to today</h2>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['search', 'Search'],
                  ['scan', 'Scan photo'],
                  ['custom-list', 'Your foods'],
                ] as Array<[View, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setView(value)}
                  className="min-h-touch rounded-lg border border-border bg-surface-raised px-2 text-sm font-medium text-text active:opacity-70"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <DailyLog date={date} />
      </div>
    </Screen>
  );
}
