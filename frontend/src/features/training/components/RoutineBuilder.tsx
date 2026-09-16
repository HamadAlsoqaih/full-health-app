/**
 * Builds a routine from the exercise library.
 *
 * Sets and target reps are per exercise and editable inline, because that is the
 * granularity people actually plan at. Reordering is deliberately omitted rather
 * than half-built: drag-and-drop on touch is a real piece of work and a broken one
 * is worse than none. Noted in docs/REMAINING-WORK.md.
 */
import { useState } from 'react';
import type { Exercise, RoutineExercise } from '@app/shared-types';
import { Button, Card, NumberField, TextField } from '@/shared/components/Field';
import { ExerciseLibrary } from './ExerciseLibrary';

interface RoutineBuilderProps {
  initialName?: string;
  initialExercises?: RoutineExercise[];
  onSave: (input: { name: string; exercises: RoutineExercise[] }) => void;
  onCancel: () => void;
  saving?: boolean;
}

export function RoutineBuilder({
  initialName = '',
  initialExercises = [],
  onSave,
  onCancel,
  saving,
}: RoutineBuilderProps) {
  const [name, setName] = useState(initialName);
  const [exercises, setExercises] = useState<RoutineExercise[]>(initialExercises);
  const [picking, setPicking] = useState(initialExercises.length === 0);
  const [error, setError] = useState<string>();

  const toggle = (exercise: Exercise) => {
    setExercises((current) => {
      const existing = current.findIndex((e) => e.exerciseId === exercise.id);
      if (existing >= 0) return current.filter((_, i) => i !== existing);
      return [
        ...current,
        {
          exerciseId: exercise.id,
          // Denormalised, so the routine still reads correctly if the library
          // is reseeded and ids move.
          exerciseName: exercise.name,
          sets: 3,
          targetReps: 10,
        },
      ];
    });
  };

  const patch = (index: number, changes: Partial<RoutineExercise>) => {
    setExercises((current) =>
      current.map((exercise, i) => (i === index ? { ...exercise, ...changes } : exercise)),
    );
  };

  const save = () => {
    if (!name.trim()) {
      setError('Give the routine a name.');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }
    setError(undefined);
    onSave({ name: name.trim(), exercises });
  };

  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Routine name"
        placeholder="Push A"
        enterKeyHint="done"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setError(undefined);
        }}
        {...(error && !name.trim() ? { error } : {})}
      />

      {exercises.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-text-muted">
            {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'}
          </h2>

          <ul className="flex flex-col gap-3">
            {exercises.map((exercise, index) => (
              <li key={`${exercise.exerciseId}-${index}`}>
                <Card>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-text">{exercise.exerciseName}</p>
                      <button
                        type="button"
                        onClick={() =>
                          setExercises((current) => current.filter((_, i) => i !== index))
                        }
                        aria-label={`Remove ${exercise.exerciseName}`}
                        className="min-h-touch shrink-0 px-2 text-sm font-medium text-danger active:opacity-70"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <NumberField
                        label="Sets"
                        value={String(exercise.sets)}
                        onChange={(event) =>
                          patch(index, {
                            sets: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                          })
                        }
                      />
                      <NumberField
                        label="Target reps"
                        value={String(exercise.targetReps)}
                        onChange={(event) =>
                          patch(index, {
                            targetReps: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                          })
                        }
                      />
                    </div>

                    <NumberField
                      label="Target weight"
                      optional
                      unit="kg"
                      value={exercise.targetWeightKg?.toString() ?? ''}
                      onChange={(event) => {
                        const parsed = Number.parseFloat(event.target.value);
                        patch(
                          index,
                          Number.isFinite(parsed)
                            ? { targetWeightKg: parsed }
                            : { targetWeightKg: undefined },
                        );
                      }}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error && name.trim() ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button variant="secondary" onClick={() => setPicking((v) => !v)}>
        {picking ? 'Done adding' : 'Add exercises'}
      </Button>

      {picking ? (
        <div className="rounded-lg border border-border p-3">
          <ExerciseLibrary
            embedded
            onSelect={toggle}
            selectedIds={exercises.map((e) => e.exerciseId)}
          />
        </div>
      ) : null}

      {/* Bottom-anchored, sticky, and clear of the tab bar. */}
      <div
        className="sticky z-20 flex flex-col gap-2 border-t border-border bg-bg py-3"
        style={{ bottom: 'calc(var(--spacing-nav-h) + env(safe-area-inset-bottom, 0px))' }}
      >
        <Button onClick={save} loading={saving}>
          Save routine
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
