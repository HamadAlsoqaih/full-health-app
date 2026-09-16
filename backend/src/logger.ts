/**
 * Structured logging. Set up before feature code, not after the first production
 * incident.
 *
 * Health data must never reach the logs: a log line is retained longer, replicated
 * further and read by more people than a database row. The redaction list below is
 * therefore deliberately broad, and request bodies are never logged wholesale.
 */
import { pino } from 'pino';
import { config } from './config/index.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-supabase-auth"]',
      'password',
      '*.password',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      // Health data. Present in request bodies across nutrition and body composition.
      'weightKg',
      '*.weightKg',
      'bodyFatPct',
      '*.bodyFatPct',
      'tapeCm',
      '*.tapeCm',
    ],
    censor: '[redacted]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: { service: 'full-health-api' },
});

/** The subset of a request the serializer below reads. */
interface LoggableRequest {
  id?: unknown;
  method?: string | undefined;
  url?: string | undefined;
  headers?: unknown;
}

/**
 * What gets logged about a request.
 *
 * Replaces pino-http's default, which logs `url` with its query string attached
 * and `query` as a parsed object. The `redact` list above cannot help there: it
 * works on known paths, and a query string is opaque to it.
 *
 * Two consequences that made this worth replacing. `GET /nutrition/search?q=…`
 * logged the user's own search term — health-adjacent, and squarely inside what
 * this file says must never be logged. And any credential a future endpoint
 * accepted in a query would have been logged in full, with nothing in the code
 * for anyone to notice.
 *
 * The path alone is what is actually useful for tracing a request. Route
 * parameters are dropped for the same reason: an id identifies a person's row.
 */
export function serializeRequest(req: LoggableRequest): Record<string, unknown> {
  return {
    id: req.id,
    method: req.method,
    path: req.url?.split('?')[0],
    // Sensitive headers are handled by `redact` above.
    headers: req.headers,
  };
}

export type Logger = typeof logger;
