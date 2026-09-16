/**
 * Completed workouts.
 *
 * Shows what was done, not just that something was: total volume per session and
 * the sets per exercise. `routineName` is a snapshot on each log, so history stays
 * readable after the routine it came from is renamed or deleted.
 */
import { useState } from 'react';
import type { WorkoutLog } from '@app/shared-types';
import { Card } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Skeleton } from '@/shared/components/Skeleton';
import { useWorkoutLogs } from '../hooks/useWorkoutLogs';

/** Sets × reps × weight. Skipped sets contribute nothing. */
function totalVolumeKg(log: WorkoutLog): number {
  return log.performed.reduce(
    (total, exercise) =>
      total +
      exercise.sets.reduce(
        (sum, set) => (set.skipped ? sum : sum + set.reps * (set.weightKg ?? 0)),
        0,
      ),
    0,
  );
}

function completedSets(log: WorkoutLog): number {
  return log.performed.reduce(
    (total, exercise) => total + exercise.sets.filter((s) => !s.skipped).length,
    0,
  );
}

function LogRow({ log }: { log: WorkoutLog }) {
  const [open, setOpen] = useState(false);
  const volume = totalVolumeKg(log);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-touch w-full items-center justify-between gap-3 text-left active:opacity-70"
      >
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-medium text-text">{log.routineName}</p>
          <p className="text-sm text-text-muted">
            {new Date(log.completedAt).toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
            {' · '}
            {completedSets(log)} sets
            {volume > 0 ? ` · ${Math.round(volume)} kg total` : ''}
            {log.durationSeconds ? ` · ${Math.round(log.durationSeconds / 60)} min` : ''}
          </p>
        </div>
        <span aria-hidden="true" className="shrink-0 text-text-muted">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open ? (
        <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          {log.performed.length === 0 ? (
            <li className="text-sm text-text-muted">No set detail was recorded.</li>
          ) : (
            log.performed.map((exercise, i) => (
              <li key={`${exercise.exerciseId}-${i}`} className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-text">{exercise.exerciseName}</p>
                <p className="text-sm text-text-muted">
                  {exercise.sets
                    .map((set) =>
                      set.skipped
                        ? 'skipped'
                        : `${set.reps}${set.weightKg ? ` × ${set.weightKg}kg` : ''}`,
                    )
                    .join(' · ')}
                </p>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </Card>
  );
}

export function WorkoutHistory() {
  const logs = useWorkoutLogs();

  if (logs.isLoading) return <Skeleton lines={4} className="h-20 w-full" label="Loading history" />;
  if (logs.isError) return <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />;

  const data = logs.data ?? [];
  if (data.length === 0) {
    return (
      <EmptyState
        title="No workouts logged yet"
        description="Finish a routine and it shows up here with your sets and weights."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {data.map((log) => (
        <li key={log.id}>
          <LogRow log={log} />
        </li>
      ))}
    </ul>
  );
}
