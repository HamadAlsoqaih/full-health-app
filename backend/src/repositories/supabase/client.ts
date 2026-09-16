/**
 * Per-request Supabase client construction.
 *
 * Built from the ANON key with the caller's JWT in the Authorization header, so
 * `auth.uid()` resolves inside Postgres and every row-level-security policy
 * applies. This is what makes the policies in 0001_init.sql load-bearing rather
 * than decorative.
 *
 * Creating a client per request is cheap — it is an HTTP wrapper over PostgREST,
 * not a connection pool — so the cost of correctness here is close to zero.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config/index.js';
import { internal } from '../../errors.js';
import type { DatabaseHandle } from '../../ports.js';

/** What auth.middleware puts in the handle. */
export interface SupabaseHandle {
  accessToken?: string;
}

export function clientFor(handle: DatabaseHandle): SupabaseClient {
  const { url, anonKey } = config.supabase.require();
  const accessToken = (handle as SupabaseHandle | undefined)?.accessToken;

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

/**
 * Normalises a PostgREST error.
 *
 * The unique-violation code is preserved verbatim, because the idempotency path
 * detects a replayed offline write by exactly that code. Losing it here would
 * silently turn a replay into a 500.
 */
export function rethrow(error: { code?: string; message?: string } | null, context: string): never {
  if (error?.code) {
    const wrapped = new Error(`${context}: ${error.message ?? error.code}`) as Error & {
      code: string;
    };
    wrapped.code = error.code;
    throw wrapped;
  }
  throw internal(`${context}: ${error?.message ?? 'unknown database error'}`, error);
}
