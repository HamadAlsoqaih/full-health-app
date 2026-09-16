/**
 * Runs a routine and records what was actually done.
 *
 * Each set is ticked off with the reps and weight performed, which is the whole
 * point of a training log: "you did Push A on Tuesday" is nearly useless, whereas
 * the weight on the bar is what tells you whether you are progressing.
 *
 * Values are pre-filled from the routine's targets so the common case is tapping
 * through, and only the sets that differed need editing.
 *
 * Completing works offline. If the write cannot reach the server it goes to the
 * outbox, and the UI says so plainly instead of pretending it saved.
 */
import { useState } from 'react';
import type { PerformedExercise, Routine } from '@app/shared-types';
import { Button, Card, NumberField } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { useLogWorkout } from '../hooks/useWorkoutLogs';

interface RoutinePlayerProps {
  routine: Routine;
  onFinish: () => void;
}

interface SetState {
  reps: string;
  weightKg: string;
  done: boolean;
}

export function RoutinePlayer({ routine, onFinish }: RoutinePlayerProps) {
  const toast = useToast();
  const logWorkout = useLogWorkout();
  const [startedAt] = useState(() => Date.now());

  const [state, setState] = useState<SetState[][]>(() =>
    routine.exercises.map((exercise) =>
      Array.from({ length: exercise.sets }, () => ({
        reps: String(exercise.targetReps),
        weightKg: exercise.targetWeightKg?.toString() ?? '',
        done: false,
      })),
    ),
  );

  const patch = (ei: number, si: number, changes: Partial<SetState>) => {
    setState((current) =>
      current.map((sets, i) =>
        i === ei ? sets.map((set, j) => (j === si ? { ...set, ...changes } : set)) : sets,
      ),
    );
  };

  const completedCount = state.flat().filter((s) => s.done).length;
  const totalCount = state.flat().length;

  const finish = async () => {
    const performed: PerformedExercise[] = routine.exercises.map((exercise, ei) => ({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      sets: (state[ei] ?? []).map((set) => {
        const reps = Number.parseInt(set.reps, 10);
        const weight = Number.parseFloat(set.weightKg);
        return {
          reps: Number.isFinite(reps) ? reps : 0,
          ...(Number.isFinite(weight) ? { weightKg: weight } : {}),
          // Recorded rather than dropped: knowing a set was skipped is useful.
          ...(set.done ? {} : { skipped: true }),
        };
      }),
    }));

    try {
      const result = await logWorkout.mutateAsync({
        routineId: routine.id,
        routineName: routine.name,
        completedAt: new Date().toISOString(),
        durationSeconds: Math.round((Date.now() - startedAt) / 1000),
        performed,
      });

      toast.show(
        result.queued
          ? 'Saved on this device — it will sync when you reconnect.'
          : 'Workout logged.',
        'success',
      );
      onFinish();
    } catch {
      toast.show('Could not save the workout. Try again.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-text">{routine.name}</h1>
        <p className="text-sm text-text-muted">
          {completedCount} of {totalCount} sets done
        </p>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-label="Sets completed"
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${totalCount ? (completedCount / totalCount) * 100 : 0}%` }}
          />
        </div>
      </header>

      <ul className="flex flex-col gap-3">
        {routine.exercises.map((exercise, ei) => (
          <li key={`${exercise.exerciseId}-${ei}`}>
            <Card>
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-medium text-text">{exercise.exerciseName}</h2>
                  <span className="text-xs text-text-muted">
                    {exercise.sets} × {exercise.targetReps}
                  </span>
                </div>

                <ul className="flex flex-col gap-2">
                  {(state[ei] ?? []).map((set, si) => (
                    <li key={si} className="flex items-end gap-2">
                      <span className="w-7 pb-3 text-sm text-text-muted">{si + 1}</span>

                      <div className="flex-1">
                        <NumberField
                          label="Reps"
                          value={set.reps}
                          onChange={(event) => patch(ei, si, { reps: event.target.value })}
                        />
                      </div>
                      <div className="flex-1">
                        <NumberField
                          label="kg"
                          value={set.weightKg}
                          onChange={(event) => patch(ei, si, { weightKg: event.target.value })}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => patch(ei, si, { done: !set.done })}
                        aria-pressed={set.done}
                        aria-label={`Mark set ${si + 1} of ${exercise.exerciseName} as done`}
                        className={[
                          'mb-0 flex size-touch shrink-0 items-center justify-center rounded-lg border',
                          'active:opacity-70',
                          set.done
                            ? 'border-success bg-success/10 text-success'
                            : 'border-border text-text-muted',
                        ].join(' ')}
                      >
                        <span aria-hidden="true">{set.done ? '✓' : '○'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <div
        className="sticky z-20 flex flex-col gap-2 border-t border-border bg-bg py-3"
        style={{ bottom: 'calc(var(--spacing-nav-h) + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button onClick={() => void finish()} loading={logWorkout.isPending}>
          Finish workout
        </Button>
        <Button variant="ghost" onClick={onFinish}>
          Discard
        </Button>
      </div>
    </div>
  );
}
