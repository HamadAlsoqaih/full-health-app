/**
 * Terminal error handler. Every failure in the app leaves through here so the
 * response body is always `{ error: { code, message } }` (spec §7).
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@app/shared-types';
import { AppError, internal, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { captureException } from '../sentry.js';

/** 404 for an unmatched route, in the same envelope as everything else. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route matches ${req.method} ${req.path}`));
};

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  // Multer signals an oversized upload with its own error code.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return new AppError('PAYLOAD_TOO_LARGE', 413, 'That image is too large.');
    }
  }

  // Malformed JSON from express.json().
  if (error instanceof SyntaxError && 'body' in error) {
    return new AppError('VALIDATION_FAILED', 400, 'Request body is not valid JSON.');
  }

  return internal('Something went wrong.', error);
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);

  // 5xx is ours to fix and goes to the error tracker; 4xx is the client's and does not.
  if (appError.status >= 500) {
    logger.error(
      { err: appError.cause ?? appError, code: appError.code, path: req.path, method: req.method },
      appError.message,
    );
    captureException(appError.cause ?? appError, {
      code: appError.code,
      path: req.path,
      method: req.method,
    });
  } else {
    logger.debug({ code: appError.code, path: req.path, method: req.method }, 'request rejected');
  }

  const body: ApiError = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  };

  if (res.headersSent) return;
  res.status(appError.status).json(body);
};
