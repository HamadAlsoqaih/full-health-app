/**
 * The service-role Supabase client.
 *
 * ⚠️ This key BYPASSES ROW-LEVEL SECURITY ENTIRELY. A query made with it can read
 * and write every user's data regardless of any policy.
 *
 * It therefore lives in exactly one module, and an eslint `no-restricted-imports`
 * rule (see eslint.config.mjs) permits importing it only from the places that
 * genuinely have no user JWT to forward:
 *
 *   - src/scripts/          the exercise seed script, which runs offline
 *   - src/jobs/             background work, which has no request
 *   - services/notifications/  dispatch triggered by a job
 *   - services/users/       creating the public mirror at registration
 *   - repositories/food-cache.repository.ts  shared, non-user-owned cache rows
 *
 * Everything else must use the per-request client built in auth.middleware.ts from
 * the anon key plus the caller's token, so policies actually apply. A rule that is
 * enforced by the linter is a rule that survives review; a comment is not.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './index.js';

let cached: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cached) return cached;

  const { url } = config.supabase.require();
  const serviceRoleKey = config.supabase.requireServiceRoleKey();

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Test seam, so a suite can assert nothing constructed an admin client. */
export function resetAdminClient(): void {
  cached = null;
}
