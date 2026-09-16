/**
 * Training tab: routines, the exercise library, and history.
 *
 * Three segments rather than nested navigation, because on a phone a segmented
 * control keeps all three one tap away instead of behind a back button.
 */
import { useState } from 'react';
import type { Routine } from '@app/shared-types';
import { Button, Card, Screen } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Skeleton } from '@/shared/components/Skeleton';
import { useToast } from '@/shared/components/Toast';
import { useRoutineMutations, useRoutines } from '../hooks/useRoutines';
import { ExerciseLibrary } from './ExerciseLibrary';
import { RoutineBuilder } from './RoutineBuilder';
import { RoutinePlayer } from './RoutinePlayer';
import { WorkoutHistory } from './WorkoutHistory';

type Segment = 'routines' | 'library' | 'history';
type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; routine: Routine }
  | { kind: 'play'; routine: Routine };

export function TrainingTab() {
  const toast = useToast();
  const [segment, setSegment] = useState<Segment>('routines');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const routines = useRoutines();
  const { create, update, remove } = useRoutineMutations();

  // The player and the builder take over the whole screen: mid-workout, a tab
  // strip and a segmented control are just things to fat-finger.
  if (mode.kind === 'play') {
    return (
      <Screen>
        <RoutinePlayer routine={mode.routine} onFinish={() => setMode({ kind: 'list' })} />
      </Screen>
    );
  }

  if (mode.kind === 'create' || mode.kind === 'edit') {
    const editing = mode.kind === 'edit' ? mode.routine : null;
    return (
      <Screen title={editing ? 'Edit routine' : 'New routine'}>
        <RoutineBuilder
          {...(editing ? { initialName: editing.name, initialExercises: editing.exercises } : {})}
          saving={create.isPending || update.isPending}
          onCancel={() => setMode({ kind: 'list' })}
          onSave={async (input) => {
            try {
              if (editing) await update.mutateAsync({ id: editing.id, patch: input });
              else await create.mutateAsync(input);
              toast.show(editing ? 'Routine updated.' : 'Routine created.', 'success');
              setMode({ kind: 'list' });
            } catch {
              toast.show('Could not save the routine.', 'error');
            }
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="Training">
      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label="Training sections"
          className="flex gap-1 rounded-lg bg-surface-raised p-1"
        >
          {(
            [
              ['routines', 'Routines'],
              ['library', 'Exercises'],
              ['history', 'History'],
            ] as Array<[Segment, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={segment === value}
              onClick={() => setSegment(value)}
              className={[
                'min-h-touch flex-1 rounded-md px-3 text-sm font-medium active:opacity-70',
                segment === value ? 'bg-surface text-text shadow-card' : 'text-text-muted',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {segment === 'routines' ? (
          routines.isLoading ? (
            <Skeleton lines={3} className="h-24 w-full" label="Loading routines" />
          ) : routines.isError ? (
            <ErrorState error={routines.error} onRetry={() => void routines.refetch()} />
          ) : (routines.data ?? []).length === 0 ? (
            <EmptyState
              title="No routines yet"
              description="Build one from the exercise library and it becomes a workout you can run."
              action={{ label: 'Create a routine', onClick: () => setMode({ kind: 'create' }) }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Button onClick={() => setMode({ kind: 'create' })}>New routine</Button>

              <ul className="flex flex-col gap-3">
                {(routines.data ?? []).map((routine) => (
                  <li key={routine.id}>
                    <Card>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col">
                            <p className="truncate font-medium text-text">{routine.name}</p>
                            <p className="text-sm text-text-muted">
                              {routine.exercises.length}{' '}
                              {routine.exercises.length === 1 ? 'exercise' : 'exercises'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setMode({ kind: 'play', routine })}
                            className="min-h-touch shrink-0 rounded-lg bg-accent px-4 font-medium text-accent-text active:opacity-80"
                          >
                            Start
                          </button>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setMode({ kind: 'edit', routine })}
                            className="min-h-touch flex-1 rounded-lg border border-border text-sm font-medium text-text active:opacity-70"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              // A routine takes real effort to build, so deleting
                              // one asks first.
                              if (
                                !window.confirm(
                                  `Delete "${routine.name}"? Your workout history is kept.`,
                                )
                              ) {
                                return;
                              }
                              void remove
                                .mutateAsync(routine.id)
                                .then(() => toast.show('Routine deleted.', 'success'))
                                .catch(() => toast.show('Could not delete it.', 'error'));
                            }}
                            className="min-h-touch flex-1 rounded-lg border border-danger/40 text-sm font-medium text-danger active:opacity-70"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : null}

        {segment === 'library' ? <ExerciseLibrary embedded /> : null}
        {segment === 'history' ? <WorkoutHistory /> : null}
      </div>
    </Screen>
  );
}
