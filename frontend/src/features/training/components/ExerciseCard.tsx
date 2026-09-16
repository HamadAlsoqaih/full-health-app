/**
 * One exercise in the library.
 *
 * The image is lazy-loaded and has explicit dimensions: 800+ exercises means
 * eagerly loading media would waste a lot of someone's mobile data, and an
 * unsized image makes the list reflow as each one arrives.
 *
 * Three of the upstream exercises have no image at all, so the placeholder is a
 * real case rather than defensive padding.
 */
import { useState } from 'react';
import type { Exercise } from '@app/shared-types';

interface ExerciseCardProps {
  exercise: Exercise;
  onSelect?: (exercise: Exercise) => void;
  /** Shows a check mark when already in the routine being built. */
  selected?: boolean;
}

export function ExerciseCard({ exercise, onSelect, selected }: ExerciseCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(exercise.mediaUrl) && !imageFailed;

  const content = (
    <>
      <div className="size-16 shrink-0 overflow-hidden rounded-md bg-surface-raised">
        {showImage ? (
          <img
            src={exercise.mediaUrl}
            alt=""
            loading="lazy"
            decoding="async"
            width={64}
            height={64}
            className="size-16 object-cover"
            // A dead upstream URL falls back to the placeholder rather than a
            // broken-image icon.
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-16 items-center justify-center text-lg text-text-muted"
          >
            ▲
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <p className="truncate font-medium text-text">{exercise.name}</p>
        <p className="truncate text-sm capitalize text-text-muted">
          {exercise.muscleGroup}
          {exercise.equipment ? ` · ${exercise.equipment}` : ''}
        </p>
        <p className="text-xs capitalize text-text-muted">{exercise.level}</p>
      </div>

      {onSelect ? (
        <span
          aria-hidden="true"
          className={`shrink-0 text-lg ${selected ? 'text-accent' : 'text-text-muted'}`}
        >
          {selected ? '✓' : '+'}
        </span>
      ) : null}
    </>
  );

  if (!onSelect) {
    return (
      <div className="flex min-h-touch items-center gap-3 rounded-lg border border-border bg-surface p-3">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(exercise)}
      aria-pressed={selected}
      className={[
        'flex min-h-touch w-full items-center gap-3 rounded-lg border p-3 text-left',
        'active:opacity-70',
        selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface',
      ].join(' ')}
    >
      {content}
    </button>
  );
}
