/**
 * Body Composition tab: log a weigh-in, see the trend, read the check-in.
 */
import { useState } from 'react';
import { Button, Card, Screen } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { SkeletonCard } from '@/shared/components/Skeleton';
import { useMe } from '@/features/auth/hooks/useAuth';
import { formatLength, formatWeight } from '@/shared/lib/units';
import { useEvaluation, useMeasurements, useTrend } from '../hooks/useBodyComp';
import { AiEvaluation } from './AiEvaluation';
import { MeasurementEntry } from './MeasurementEntry';
import { TrendChart } from './TrendChart';

const WINDOWS = [30, 60, 90] as const;

export function BodyCompositionTab() {
  const [entering, setEntering] = useState(false);
  const [days, setDays] = useState<number>(30);

  const me = useMe(true);
  const units = me.data?.units ?? 'metric';

  const measurements = useMeasurements();
  const trend = useTrend(days);
  const evaluation = useEvaluation();

  if (entering) {
    return (
      <Screen title="Log a weigh-in">
        <MeasurementEntry units={units} onDone={() => setEntering(false)} />
      </Screen>
    );
  }

  if (measurements.isLoading) {
    return (
      <Screen title="Body">
        <div className="flex flex-col gap-4">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={5} />
        </div>
      </Screen>
    );
  }

  if (measurements.isError) {
    return (
      <Screen title="Body">
        <ErrorState error={measurements.error} onRetry={() => void measurements.refetch()} />
      </Screen>
    );
  }

  const entries = measurements.data ?? [];
  const latest = entries[0];

  return (
    <Screen title="Body">
      <div className="flex flex-col gap-4">
        <Button onClick={() => setEntering(true)}>Log a weigh-in</Button>

        {entries.length === 0 ? (
          <EmptyState
            title="No measurements yet"
            description="Log your weight and the app starts tracking how it moves against what you eat."
          />
        ) : (
          <>
            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium text-text-muted">Weight</h2>
                  <div className="flex gap-1">
                    {WINDOWS.map((window) => (
                      <button
                        key={window}
                        type="button"
                        onClick={() => setDays(window)}
                        aria-pressed={days === window}
                        className={[
                          'min-h-touch rounded-md px-2.5 text-xs font-medium active:opacity-70',
                          days === window ? 'bg-accent-soft text-accent' : 'text-text-muted',
                        ].join(' ')}
                      >
                        {window}d
                      </button>
                    ))}
                  </div>
                </div>

                {latest ? (
                  <p className="text-3xl font-semibold text-text">
                    {formatWeight(latest.weightKg, units)}
                    {latest.bodyFatPct !== undefined ? (
                      <span className="text-base font-normal text-text-muted">
                        {' '}
                        · {latest.bodyFatPct}% fat
                      </span>
                    ) : null}
                  </p>
                ) : null}

                <TrendChart measurements={entries} units={units} />
              </div>
            </Card>

            <AiEvaluation evaluation={evaluation.data} trend={trend.data} units={units} />

            {latest?.tapeCm && Object.keys(latest.tapeCm).length > 0 ? (
              <Card>
                <h2 className="mb-2 text-sm font-medium text-text-muted">Latest measurements</h2>
                <dl className="grid grid-cols-2 gap-2">
                  {Object.entries(latest.tapeCm).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt className="text-sm capitalize text-text-muted">{key}</dt>
                      <dd className="text-sm font-medium text-text">
                        {formatLength(value as number, units)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ) : null}

            <Card>
              <h2 className="mb-2 text-sm font-medium text-text-muted">History</h2>
              <ul className="flex flex-col gap-1">
                {entries.slice(0, 20).map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-2 py-1 text-sm">
                    <span className="text-text-muted">
                      {new Date(`${entry.date}T00:00:00Z`).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <span className="font-medium text-text">
                      {formatWeight(entry.weightKg, units)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </Screen>
  );
}
