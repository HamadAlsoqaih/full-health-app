/**
 * The only repository code permitted to use the service-role client.
 *
 * ⚠️ The service-role key BYPASSES ROW-LEVEL SECURITY. Everything in this file is
 * therefore restricted to writes on tables that are **not user-owned**, where
 * there is no user to scope to and the client-facing RLS policies deliberately
 * allow no writes at all:
 *
 *   - `exercises`   — global reference data, written only by the seed script.
 *   - `food_cache`  — shared upstream lookups with user_id NULL.
 *
 * Kept as a separate module, and separately allowlisted in eslint.config.mjs, so
 * the privilege boundary is one small file a reviewer can read in full rather than
 * two calls buried among thirty RLS-scoped ones.
 *
 * Note what is NOT here: per-user AI estimate rows. Those have an owner, so they
 * go through the request-scoped client and are subject to RLS like anything else.
 */
import type { Exercise, FoodItem } from '@app/shared-types';
import { getAdminClient } from '../../config/supabaseAdmin.js';
import { internal } from '../../errors.js';
import type { FoodCacheRow } from '../../models/index.js';
import { rethrow } from './client.js';
import { toFoodCacheRow } from './mappers.js';

type Row = Record<string, unknown>;

export async function upsertExercises(
  exercises: Array<Omit<Exercise, 'id'> & { externalId: string }>,
): Promise<number> {
  const admin = getAdminClient();
  const payload = exercises.map((e) => ({
    external_id: e.externalId,
    name: e.name,
    muscle_group: e.muscleGroup,
    secondary_muscles: e.secondaryMuscles,
    category: e.category,
    level: e.level,
    equipment: e.equipment ?? null,
    media_url: e.mediaUrl ?? null,
    instructions: e.instructions,
  }));

  const { error, count } = await admin
    .from('exercises')
    .upsert(payload, { onConflict: 'external_id', count: 'exact' });
  if (error) rethrow(error, 'exercises.upsertMany');
  return count ?? payload.length;
}

export async function putSharedFoodCache(
  row: Omit<FoodCacheRow, 'id' | 'fetchedAt'>,
  fetchedAt: string,
): Promise<FoodCacheRow> {
  // Guard rather than trust the caller: this function must never be used to write
  // a row that belongs to a user, which would sidestep that user's RLS policy.
  if (row.userId !== null) {
    throw internal('putSharedFoodCache was given an owned row; use the scoped client.');
  }

  const admin = getAdminClient();
  const { data, error } = await admin
    .from('food_cache')
    .upsert(
      {
        kind: row.kind,
        source: row.source,
        query: row.query,
        user_id: null,
        payload: row.payload,
        fetched_at: fetchedAt,
      },
      { onConflict: 'kind,source,query' },
    )
    .select('*')
    .single();
  if (error) rethrow(error, 'foodCache.put');

  const created = data && typeof data === 'object' ? (data as Row) : null;
  if (!created) throw internal('foodCache.put returned no row');
  return toFoodCacheRow(created);
}

/** Narrowing helper so the payload type stays honest at the call site. */
export type SharedCachePayload = FoodItem | FoodItem[];
