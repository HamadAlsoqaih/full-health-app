/**
 * Food search across the user's own foods and the external databases.
 *
 * Debounced, and the previous request is aborted when the term changes: each
 * uncached keystroke would otherwise spend a quota shared by every user of the
 * deployment.
 */
import { useEffect, useRef, useState } from 'react';
import type { FoodItem, NutritionSearchResult } from '@app/shared-types';
import { useApi } from '@/shared/lib/ApiProvider';
import { Card, NumberField, TextField, Button } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Skeleton } from '@/shared/components/Skeleton';
import { useToast } from '@/shared/components/Toast';
import { nutritionApi } from '../api';
import { todayIso, useLogFood } from '../hooks/useDailyLog';

const DEBOUNCE_MS = 400;

export function FoodSearch({ onLogged }: { onLogged?: () => void }) {
  const { client } = useApi();
  const toast = useToast();
  const logFood = useLogFood(todayIso());

  const [term, setTerm] = useState('');
  const [result, setResult] = useState<NutritionSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [chosen, setChosen] = useState<FoodItem | null>(null);
  const [multiplier, setMultiplier] = useState('1');

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResult(null);
      setError(undefined);
      return;
    }

    const timer = window.setTimeout(() => {
      // Supersede the in-flight request rather than racing it.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(undefined);

      void nutritionApi(client)
        .search(query, controller.signal)
        .then((response) => {
          if (!controller.signal.aborted) setResult(response);
        })
        .catch((caught: unknown) => {
          if (!controller.signal.aborted) setError(caught);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [term, client]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const log = async () => {
    if (!chosen) return;
    const parsed = Number.parseFloat(multiplier);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    try {
      const outcome = await logFood.mutateAsync({
        foodItemId: chosen.id,
        date: todayIso(),
        servingMultiplier: parsed,
      });
      toast.show(
        outcome.queued ? 'Saved on this device — it will sync later.' : 'Logged.',
        'success',
      );
      setChosen(null);
      setMultiplier('1');
      onLogged?.();
    } catch {
      toast.show('Could not log that food.', 'error');
    }
  };

  if (chosen) {
    const servings = Number.parseFloat(multiplier) || 0;
    return (
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-0.5">
            <p className="font-medium text-text">{chosen.name}</p>
            {chosen.brand ? <p className="text-sm text-text-muted">{chosen.brand}</p> : null}
            <p className="text-xs text-text-muted">One serving is {chosen.servingLabel}.</p>
          </div>

          <NumberField
            label="Servings"
            value={multiplier}
            onChange={(event) => setMultiplier(event.target.value)}
          />

          <dl className="grid grid-cols-4 gap-2 rounded-lg bg-surface-raised p-3 text-center">
            {[
              ['kcal', chosen.calories],
              ['Protein', chosen.proteinG],
              ['Carbs', chosen.carbsG],
              ['Fat', chosen.fatG],
            ].map(([label, value]) => (
              <div key={label as string} className="flex flex-col">
                <dt className="text-xs text-text-muted">{label as string}</dt>
                <dd className="font-semibold text-text">
                  {Math.round((value as number) * servings)}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-2">
            <Button onClick={() => void log()} loading={logFood.isPending}>
              Log it
            </Button>
            <Button variant="ghost" onClick={() => setChosen(null)}>
              Back to search
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Search foods"
        type="search"
        enterKeyHint="search"
        autoCapitalize="none"
        autoCorrect="off"
        hint="Searches your own foods and the public food databases."
        placeholder="Chicken breast, oats, yoghurt…"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />

      {loading ? <Skeleton lines={5} className="h-16 w-full" label="Searching foods" /> : null}

      {error ? <ErrorState error={error} /> : null}

      {result && !loading ? (
        result.items.length === 0 ? (
          <EmptyState
            title="Nothing found"
            description="Try a different term, or add it as one of your own foods."
          />
        ) : (
          <>
            {result.unavailableSources.length > 0 ? (
              <p className="text-xs text-warning">
                Some food sources were unavailable, so these results may be incomplete.
              </p>
            ) : null}

            <ul className="flex flex-col gap-2">
              {result.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setChosen(item)}
                    className="flex min-h-touch w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-left active:opacity-70"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-text">{item.name}</span>
                      <span className="truncate text-sm text-text-muted">
                        {item.brand ? `${item.brand} · ` : ''}
                        {item.servingLabel}
                        {item.source === 'custom' ? ' · your food' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-text">
                      {Math.round(item.calories)} kcal
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}
