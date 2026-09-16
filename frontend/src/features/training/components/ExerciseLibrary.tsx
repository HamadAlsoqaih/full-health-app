/**
 * Browsable exercise library.
 *
 * Filtering is client-side over a list already fetched and cached for an hour:
 * the whole library is ~876 rows and does not change between seed runs, so
 * round-tripping a search would be slower and would spend the user's data for
 * nothing.
 */
import { useMemo, useState } from 'react';
import type { Exercise, MuscleGroup } from '@app/shared-types';
import { Screen, TextField } from '@/shared/components/Field';
import { EmptyState } from '@/shared/components/EmptyState';
import { ErrorState } from '@/shared/components/ErrorState';
import { Skeleton } from '@/shared/components/Skeleton';
import { useExercises } from '../hooks/useExercises';
import { ExerciseCard } from './ExerciseCard';

const MUSCLE_GROUPS: MuscleGroup[] = [
  'abdominals',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower back',
  'middle back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
  'abductors',
  'adductors',
];

interface ExerciseLibraryProps {
  /** Present when picking exercises for a routine. */
  onSelect?: (exercise: Exercise) => void;
  selectedIds?: string[];
  embedded?: boolean;
}

export function ExerciseLibrary({ onSelect, selectedIds = [], embedded }: ExerciseLibraryProps) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<MuscleGroup | 'all'>('all');
  const exercises = useExercises();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (exercises.data ?? []).filter((exercise) => {
      if (group !== 'all' && exercise.muscleGroup !== group) return false;
      if (term && !exercise.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [exercises.data, search, group]);

  const body = (
    <div className="flex flex-col gap-4">
      <TextField
        label="Search exercises"
        type="search"
        enterKeyHint="search"
        autoCapitalize="none"
        placeholder="Squat, press, curl…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {/* Horizontal chips: 17 muscle groups will not fit vertically on a phone. */}
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        // Keeps the momentum scroll inside the strip.
        style={{ overscrollBehaviorX: 'contain' }}
      >
        {(['all', ...MUSCLE_GROUPS] as Array<MuscleGroup | 'all'>).map((option) => {
          const isOn = group === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setGroup(option)}
              aria-pressed={isOn}
              className={[
                'min-h-touch shrink-0 rounded-full border px-4 text-sm font-medium capitalize',
                'active:opacity-70',
                isOn
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface-raised text-text-muted',
              ].join(' ')}
            >
              {option === 'all' ? 'All' : option}
            </button>
          );
        })}
      </div>

      {exercises.isLoading ? (
        <Skeleton lines={8} className="h-20 w-full" label="Loading exercises" />
      ) : exercises.isError ? (
        <ErrorState error={exercises.error} onRetry={() => void exercises.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No exercises match"
          description={
            (exercises.data ?? []).length === 0
              ? 'The exercise library has not been seeded yet. See docs/SETUP.md.'
              : 'Try a different search or muscle group.'
          }
        />
      ) : (
        <>
          <p className="text-xs text-text-muted">
            {filtered.length} {filtered.length === 1 ? 'exercise' : 'exercises'}
          </p>
          <ul className="flex flex-col gap-2">
            {filtered.map((exercise) => (
              <li key={exercise.id}>
                <ExerciseCard
                  exercise={exercise}
                  {...(onSelect ? { onSelect } : {})}
                  selected={selectedIds.includes(exercise.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return embedded ? body : <Screen title="Exercises">{body}</Screen>;
}
