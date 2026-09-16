/**
 * The one error type the API throws, so every failure leaves through the same
 * envelope: `{ error: { code, message } }` (spec §7).
 *
 * `code` is stable and machine-readable — the frontend branches on it. `message` is
 * human-facing and may be reworded freely. Nothing here should ever contain health
 * data, since these strings reach logs and the error tracker.
 */
import type { ApiErrorCode } from '@app/shared-types';

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  /** The underlying failure, kept for logging but never sent to the client. */
  override readonly cause?: unknown;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options?: { details?: Record<string, string[]>; cause?: unknown },
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    if (options?.details) this.details = options.details;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export const badRequest = (message: string, details?: Record<string, string[]>) =>
  new AppError('VALIDATION_FAILED', 400, message, details ? { details } : undefined);

export const unauthenticated = (message = 'Authentication required.') =>
  new AppError('UNAUTHENTICATED', 401, message);

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError('FORBIDDEN', 403, message);

export const notFound = (message = 'Not found.') => new AppError('NOT_FOUND', 404, message);

export const conflict = (message: string) => new AppError('CONFLICT', 409, message);

export const payloadTooLarge = (message: string) => new AppError('PAYLOAD_TOO_LARGE', 413, message);

export const unsupportedMediaType = (message: string) =>
  new AppError('UNSUPPORTED_MEDIA_TYPE', 415, message);

export const rateLimited = (message = 'Too many requests. Try again shortly.') =>
  new AppError('RATE_LIMITED', 429, message);

/**
 * A food source could not be consulted and the cache had no answer. Deliberately
 * an error rather than an empty result: silently returning nothing would look to
 * the user like "this food does not exist".
 */
export const foodSourceUnavailable = (message: string, cause?: unknown) =>
  new AppError(
    'FOOD_SOURCE_UNAVAILABLE',
    503,
    message,
    cause !== undefined ? { cause } : undefined,
  );

export const aiUnavailable = (message: string, cause?: unknown) =>
  new AppError('AI_UNAVAILABLE', 503, message, cause !== undefined ? { cause } : undefined);

export const aiQuotaExhausted = (message: string) =>
  new AppError('AI_QUOTA_EXHAUSTED', 429, message);

export const configurationError = (message: string, cause?: unknown) =>
  new AppError('CONFIGURATION_ERROR', 500, message, cause !== undefined ? { cause } : undefined);

export const internal = (message = 'Something went wrong.', cause?: unknown) =>
  new AppError('INTERNAL', 500, message, cause !== undefined ? { cause } : undefined);

/** Postgres unique-violation. Central because the idempotency path depends on it. */
export const PG_UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
