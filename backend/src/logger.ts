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

export type Logger = typeof logger;
