/**
 * Empty state.
 *
 * Every empty list gets one. A blank screen is indistinguishable from a broken
 * one, and the most useful thing an empty state can do is name the single action
 * that fills it.
 */
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  /** What to do about it. Kept short; this is not documentation. */
  description?: string;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? (
        <div aria-hidden="true" className="text-text-muted">
          {icon}
        </div>
      ) : null}
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {description ? <p className="max-w-xs text-sm text-text-muted">{description}</p> : null}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 min-h-touch rounded-lg bg-accent px-5 font-medium text-accent-text active:opacity-80"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
