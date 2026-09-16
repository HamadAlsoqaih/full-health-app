/**
 * Sentry initialisation. Imported first in app.ts so instrumentation is in place
 * before any other module is evaluated.
 *
 * With no DSN configured every export here is a no-op, which is the state in CI,
 * in tests and on a fresh clone. Wiring error tracking in from the start is the
 * point; making it mandatory to run the app is not.
 */
import * as Sentry from '@sentry/node';
import { config } from './config/index.js';

let initialised = false;

export function initSentry(): void {
  if (initialised || !config.sentry.enabled || !config.sentry.dsn) return;

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.env,
    tracesSampleRate: config.sentry.tracesSampleRate,
    // Health data must not be shipped to a third-party error tracker. Request
    // bodies are dropped wholesale rather than filtered field by field, because a
    // filter has to be kept in step with every new endpoint and eventually is not.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      return event;
    },
  });

  initialised = true;
}

/** Reports an error if Sentry is configured; otherwise does nothing. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function isSentryEnabled(): boolean {
  return initialised;
}
