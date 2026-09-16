/**
 * Top-level error boundary.
 *
 * Without this, a render error in any component leaves the user staring at a blank
 * white screen with no way out — the worst possible failure mode in an installed
 * PWA, where there is no address bar to retype a URL into.
 *
 * Reports to Sentry when configured, and always offers a reload.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { config } from '@/shared/lib/config';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (config.sentry.enabled) {
      Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
    } else {
      console.error('Unhandled render error:', error, info.componentStack);
    }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center"
      >
        <h1 className="text-xl font-semibold text-text">Something broke</h1>
        <p className="max-w-xs text-sm text-text-muted">
          Sorry — the app hit an unexpected error. Reloading usually fixes it. Anything you logged
          is safe.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-touch rounded-lg bg-accent px-5 font-medium text-accent-text active:opacity-80"
        >
          Reload
        </button>
      </div>
    );
  }
}
