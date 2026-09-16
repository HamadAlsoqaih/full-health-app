/**
 * Error state.
 *
 * Distinguishes "you are offline" from "something went wrong", because the user's
 * response differs: one is worth retrying immediately, the other is not their
 * problem to solve. The distinction comes from ApiRequestError.isOffline, which
 * the client sets for transport failures.
 */
import { ApiRequestError } from '@/shared/lib/apiClient';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  /** Overrides the derived message where a screen has better context. */
  title?: string;
}

function describe(error: unknown): { title: string; description: string; retryable: boolean } {
  if (error instanceof ApiRequestError) {
    if (error.isOffline) {
      return {
        title: 'You appear to be offline',
        description:
          'Anything you log now is saved on this device and will sync when you reconnect.',
        retryable: true,
      };
    }
    if (error.code === 'UNAUTHENTICATED') {
      return {
        title: 'Your session expired',
        description: 'Log in again to continue.',
        retryable: false,
      };
    }
    if (error.code === 'RATE_LIMITED') {
      return {
        title: 'Too many requests',
        description: 'Wait a moment and try again.',
        retryable: true,
      };
    }
    if (error.code === 'FOOD_SOURCE_UNAVAILABLE') {
      return {
        title: 'Food database unavailable',
        description: 'You can still log your own custom foods.',
        retryable: true,
      };
    }
    if (error.code === 'AI_QUOTA_EXHAUSTED') {
      return {
        title: 'Photo scanning is unavailable today',
        description: "The app's daily AI allowance is used up. You can still log food manually.",
        retryable: false,
      };
    }
    // Server-supplied message for anything else; it is written for the user.
    return {
      title: 'Something went wrong',
      description: error.message,
      retryable: error.status >= 500,
    };
  }

  return {
    title: 'Something went wrong',
    description: 'Try again in a moment.',
    retryable: true,
  };
}

export function ErrorState({ error, onRetry, title }: ErrorStateProps) {
  const described = describe(error);

  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-text">{title ?? described.title}</h2>
      <p className="max-w-xs text-sm text-text-muted">{described.description}</p>
      {onRetry && described.retryable ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 min-h-touch rounded-lg border border-border px-5 font-medium text-text active:opacity-80"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
