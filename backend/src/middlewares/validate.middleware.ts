/**
 * Request validation. Each endpoint gets a zod schema (see src/validation/).
 *
 * Schemas are `.strict()` at their definition, so an unexpected field is an error
 * rather than being silently dropped. That is what stops a client sending, say,
 * `onboardingComplete` to an endpoint that never intended to accept it.
 */
import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { badRequest } from '../errors.js';

type Part = 'body' | 'query' | 'params';

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Validates one part of the request and REPLACES it with the parsed result, so
 * downstream handlers see coerced, trimmed, defaulted values rather than raw input.
 */
export function validate(schema: z.ZodType, part: Part = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(badRequest('Request validation failed.', fieldErrors(result.error)));
      return;
    }
    // Express 5 makes req.query a getter, so it is redefined rather than assigned.
    if (part === 'query') {
      Object.defineProperty(req, 'query', { value: result.data, configurable: true });
    } else {
      req[part] = result.data as never;
    }
    next();
  };
}
