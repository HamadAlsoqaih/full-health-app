/**
 * Loading placeholder.
 *
 * A skeleton rather than a spinner for list and card loads: it reserves the space
 * the content will occupy, so the layout does not jump when data arrives — which
 * on a phone is the difference between a calm screen and one that shifts under
 * the user's thumb mid-tap.
 *
 * `aria-hidden` with a sibling live region: a screen reader should hear "loading",
 * not a description of decorative grey boxes.
 */
interface SkeletonProps {
  className?: string;
  /** Number of stacked bars, for list placeholders. */
  lines?: number;
  label?: string;
}

export function Skeleton({ className = '', lines = 1, label = 'Loading' }: SkeletonProps) {
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={`animate-pulse rounded-md bg-surface-raised ${className || 'h-4 w-full'}`}
          />
        ))}
      </div>
    </>
  );
}

/** Card-shaped placeholder, matching the real card's padding and radius. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <Skeleton lines={lines} className="h-4 w-full" />
    </div>
  );
}
