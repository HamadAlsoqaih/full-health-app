/**
 * Supabase-backed repositories.
 *
 * Two invariants hold throughout, both deliberate:
 *
 * 1. **Every user-owned query filters on user_id**, even though row-level security
 *    already enforces the same restriction. RLS is the layer the credential-free
 *    test suite cannot exercise, so it must never be the only defence — a
 *    forgotten filter should be a visible bug, not a silent cross-tenant read.
 *
 * 2. **Unique violations propagate.** The idempotency path detects a replayed
 *    offline write by Postgres code 23505, so inserts on offline-syncable tables
 *    must not swallow it.
 *
 * The service-role client is used in exactly one place here: shared food_cache
 * writes, which touch non-user-owned rows and so have no owning user to scope to.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FoodItem } from '@app/shared-types';
import { config } from '../../config/index.js';
import { internal, notFound } from '../../errors.js';
import type { EvaluationRow, FoodCacheRow, UserRow } from '../../models/index.js';
import type { NewFoodLogRow, Repositories, RepositoryContext } from '../index.js';
import { putSharedFoodCache, upsertExercises } from './admin-writes.js';
import { clientFor, rethrow } from './client.js';
import {
  toBodyMeasurement,
  toCustomFood,
  toEvaluationRow,
  toExercise,
  toFoodCacheRow,
  toFoodLogEntry,
  toPushSubscription,
  toRoutine,
  toSubscriptionStatus,
  toUserRow,
  toWorkoutLog,
} from './mappers.js';

type Row = Record<string, unknown>;

const asRows = (data: unknown): Row[] => (Array.isArray(data) ? (data as Row[]) : []);
const asRow = (data: unknown): Row | null =>
  data && typeof data === 'object' ? (data as Row) : null;

export function createSupabaseRepositories(ctx: RepositoryContext): Repositories {
  const db: SupabaseClient = clientFor(ctx.db);

  return {
    // =======================================================================
    // users
    // =======================================================================
    users: {
      async findById(userId) {
        const { data, error } = await db.from('users').select('*').eq('id', userId).maybeSingle();
        if (error) rethrow(error, 'users.findById');
        const row = asRow(data);
        return row ? toUserRow(row) : null;
      },

      async ensure(userId, email) {
        // auth.users stays the source of truth for the email, so a conflict
        // refreshes the mirror rather than ignoring it and letting the copy drift.
        const { data, error } = await db
          .from('users')
          .upsert({ id: userId, email }, { onConflict: 'id' })
          .select('*')
          .single();
        if (error) rethrow(error, 'users.ensure');
        const row = asRow(data);
        if (!row) throw internal('users.ensure returned no row');
        return toUserRow(row);
      },

      async update(userId, patch) {
        const payload: Row = {};
        if (patch.displayName !== undefined) payload.display_name = patch.displayName;
        if (patch.onboardingComplete !== undefined) {
          payload.onboarding_complete = patch.onboardingComplete;
        }
        if (patch.goals !== undefined) payload.goals = patch.goals;
        if (patch.units !== undefined) payload.units = patch.units;
        if (patch.preferences !== undefined) payload.preferences = patch.preferences;
        if (patch.email !== undefined) payload.email = patch.email;

        const { data, error } = await db
          .from('users')
          .update(payload)
          .eq('id', userId)
          .select('*')
          .single();
        if (error) rethrow(error, 'users.update');
        const row = asRow(data);
        if (!row) throw notFound('User profile not found.');
        return toUserRow(row);
      },

      async hasAnyMeasurement(userId) {
        // head + exact count: the rows themselves are irrelevant, only whether any
        // exist, and this is on the hot path for every /users/me call.
        const { count, error } = await db
          .from('body_measurements')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (error) rethrow(error, 'users.hasAnyMeasurement');
        return (count ?? 0) > 0;
      },
    },

    // =======================================================================
    // exercises — global reference data
    // =======================================================================
    exercises: {
      async list(filter) {
        let query = db.from('exercises').select('*').order('name');
        if (filter?.muscleGroup) query = query.eq('muscle_group', filter.muscleGroup);
        // ilike is safe here: the value is a bound parameter, not interpolated SQL.
        if (filter?.search) query = query.ilike('name', `%${filter.search}%`);

        const { data, error } = await query.limit(1000);
        if (error) rethrow(error, 'exercises.list');
        return asRows(data).map(toExercise);
      },

      async findById(id) {
        const { data, error } = await db.from('exercises').select('*').eq('id', id).maybeSingle();
        if (error) rethrow(error, 'exercises.findById');
        const row = asRow(data);
        return row ? toExercise(row) : null;
      },

      async upsertMany(exercises) {
        // Delegated: exercises are global reference data with no owning user, so
        // the write needs the service-role client. That privilege is confined to
        // admin-writes.ts — see the warning at the top of that file.
        return upsertExercises(exercises);
      },
    },

    // =======================================================================
    // routines
    // =======================================================================
    routines: {
      async list(userId) {
        const { data, error } = await db
          .from('routines')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (error) rethrow(error, 'routines.list');
        return asRows(data).map(toRoutine);
      },

      async findById(userId, id) {
        const { data, error } = await db
          .from('routines')
          .select('*')
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle();
        if (error) rethrow(error, 'routines.findById');
        const row = asRow(data);
        return row ? toRoutine(row) : null;
      },

      async create(userId, input) {
        const { data, error } = await db
          .from('routines')
          .insert({ user_id: userId, name: input.name, exercises: input.exercises })
          .select('*')
          .single();
        if (error) rethrow(error, 'routines.create');
        const row = asRow(data);
        if (!row) throw internal('routines.create returned no row');
        return toRoutine(row);
      },

      async update(userId, id, patch) {
        const payload: Row = {};
        if (patch.name !== undefined) payload.name = patch.name;
        if (patch.exercises !== undefined) payload.exercises = patch.exercises;

        const { data, error } = await db
          .from('routines')
          .update(payload)
          .eq('user_id', userId)
          .eq('id', id)
          .select('*')
          .single();
        if (error) rethrow(error, 'routines.update');
        const row = asRow(data);
        if (!row) throw notFound('Routine not found.');
        return toRoutine(row);
      },

      async remove(userId, id) {
        // Workout history survives: routine_id is ON DELETE SET NULL and each log
        // carries its own routine_name snapshot.
        const { error } = await db.from('routines').delete().eq('user_id', userId).eq('id', id);
        if (error) rethrow(error, 'routines.remove');
      },
    },

    // =======================================================================
    // workout_logs — offline-syncable
    // =======================================================================
    workoutLogs: {
      async list(userId, limit) {
        const { data, error } = await db
          .from('workout_logs')
          .select('*')
          .eq('user_id', userId)
          .order('completed_at', { ascending: false })
          .limit(limit ?? 200);
        if (error) rethrow(error, 'workoutLogs.list');
        return asRows(data).map(toWorkoutLog);
      },

      async findByClientId(userId, clientId) {
        const { data, error } = await db
          .from('workout_logs')
          .select('*')
          .eq('user_id', userId)
          .eq('client_id', clientId)
          .maybeSingle();
        if (error) rethrow(error, 'workoutLogs.findByClientId');
        const row = asRow(data);
        return row ? toWorkoutLog(row) : null;
      },

      async insert(userId, input) {
        const { data, error } = await db
          .from('workout_logs')
          .insert({
            user_id: userId,
            client_id: input.clientId,
            routine_id: input.routineId,
            routine_name: input.routineName,
            completed_at: input.completedAt,
            duration_seconds: input.durationSeconds ?? null,
            performed: input.performed,
            notes: input.notes ?? null,
          })
          .select('*')
          .single();
        // Propagated, not swallowed: 23505 is how a replayed sync is recognised.
        if (error) rethrow(error, 'workoutLogs.insert');
        const row = asRow(data);
        if (!row) throw internal('workoutLogs.insert returned no row');
        return toWorkoutLog(row);
      },

      async findLatest(userId) {
        const { data, error } = await db
          .from('workout_logs')
          .select('*')
          .eq('user_id', userId)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) rethrow(error, 'workoutLogs.findLatest');
        const row = asRow(data);
        return row ? toWorkoutLog(row) : null;
      },
    },

    // =======================================================================
    // custom_foods — offline-syncable
    // =======================================================================
    customFoods: {
      async list(userId) {
        const { data, error } = await db
          .from('custom_foods')
          .select('*')
          .eq('user_id', userId)
          .order('name');
        if (error) rethrow(error, 'customFoods.list');
        return asRows(data).map(toCustomFood);
      },

      async findById(userId, id) {
        const { data, error } = await db
          .from('custom_foods')
          .select('*')
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle();
        if (error) rethrow(error, 'customFoods.findById');
        const row = asRow(data);
        return row ? toCustomFood(row) : null;
      },

      async findByClientId(userId, clientId) {
        const { data, error } = await db
          .from('custom_foods')
          .select('*')
          .eq('user_id', userId)
          .eq('client_id', clientId)
          .maybeSingle();
        if (error) rethrow(error, 'customFoods.findByClientId');
        const row = asRow(data);
        return row ? toCustomFood(row) : null;
      },

      async insert(userId, input) {
        const { data, error } = await db
          .from('custom_foods')
          .insert({
            user_id: userId,
            client_id: input.clientId,
            name: input.name,
            brand: input.brand ?? null,
            serving_label: input.servingLabel ?? '1 serving',
            calories: input.calories,
            protein_g: input.proteinG,
            carbs_g: input.carbsG,
            fat_g: input.fatG,
            fiber_g: input.fiberG ?? null,
          })
          .select('*')
          .single();
        if (error) rethrow(error, 'customFoods.insert');
        const row = asRow(data);
        if (!row) throw internal('customFoods.insert returned no row');
        return toCustomFood(row);
      },

      async search(userId, query) {
        const { data, error } = await db
          .from('custom_foods')
          .select('*')
          .eq('user_id', userId)
          .ilike('name', `%${query}%`)
          .limit(50);
        if (error) rethrow(error, 'customFoods.search');
        return asRows(data).map(toCustomFood);
      },
    },

    // =======================================================================
    // food_log — offline-syncable
    // =======================================================================
    foodLog: {
      async listByDate(userId, date) {
        const { data, error } = await db
          .from('food_log')
          .select('*')
          .eq('user_id', userId)
          .eq('date', date)
          .order('logged_at');
        if (error) rethrow(error, 'foodLog.listByDate');
        return asRows(data).map(toFoodLogEntry);
      },

      async listByRange(userId, fromDate, toDate) {
        const { data, error } = await db
          .from('food_log')
          .select('*')
          .eq('user_id', userId)
          .gte('date', fromDate)
          .lte('date', toDate)
          .order('date');
        if (error) rethrow(error, 'foodLog.listByRange');
        return asRows(data).map(toFoodLogEntry);
      },

      async findByClientId(userId, clientId) {
        const { data, error } = await db
          .from('food_log')
          .select('*')
          .eq('user_id', userId)
          .eq('client_id', clientId)
          .maybeSingle();
        if (error) rethrow(error, 'foodLog.findByClientId');
        const row = asRow(data);
        return row ? toFoodLogEntry(row) : null;
      },

      async insert(userId, input: NewFoodLogRow) {
        // calories/protein_g/carbs_g/fat_g are GENERATED columns and must not be
        // written; Postgres rejects an explicit value for them.
        const { data, error } = await db
          .from('food_log')
          .insert({
            user_id: userId,
            client_id: input.clientId,
            date: input.date,
            food_item_id: input.foodItemId,
            food_name: input.foodName,
            source: input.source,
            serving_label: input.servingLabel,
            serving_multiplier: input.servingMultiplier,
            meal: input.meal ?? null,
            base_calories: input.baseCalories,
            base_protein_g: input.baseProteinG,
            base_carbs_g: input.baseCarbsG,
            base_fat_g: input.baseFatG,
          })
          .select('*')
          .single();
        if (error) rethrow(error, 'foodLog.insert');
        const row = asRow(data);
        if (!row) throw internal('foodLog.insert returned no row');
        return toFoodLogEntry(row);
      },

      async remove(userId, id) {
        const { error } = await db.from('food_log').delete().eq('user_id', userId).eq('id', id);
        if (error) rethrow(error, 'foodLog.remove');
      },
    },

    // =======================================================================
    // food_cache — shared upstream data plus per-user AI estimates
    // =======================================================================
    foodCache: {
      async get(kind, source, query) {
        const { data, error } = await db
          .from('food_cache')
          .select('*')
          .eq('kind', kind)
          .eq('source', source)
          .eq('query', query)
          .maybeSingle();
        if (error) rethrow(error, 'foodCache.get');

        const row = asRow(data);
        if (!row) return null;

        const cached: FoodCacheRow = toFoodCacheRow(row);
        // A stale entry is a miss, not a hit. Without this the cache would pin
        // whatever the upstream said the first time, forever.
        const ageMs = ctx.clock().getTime() - Date.parse(cached.fetchedAt);
        if (ageMs > config.foodDatabase.cacheTtlDays * 86_400_000) return null;
        return cached;
      },

      async put(row) {
        // Shared, unowned cache rows: delegated to admin-writes.ts, which asserts
        // the row really has no owner before using the service-role client.
        return putSharedFoodCache(row, ctx.clock().toISOString());
      },

      async getEstimate(userId, estimateId) {
        const { data, error } = await db
          .from('food_cache')
          .select('*')
          .eq('kind', 'estimate')
          .eq('query', estimateId)
          .eq('user_id', userId)
          .maybeSingle();
        if (error) rethrow(error, 'foodCache.getEstimate');
        const row = asRow(data);
        return row ? (toFoodCacheRow(row).payload as FoodItem) : null;
      },

      async putEstimate(userId, estimateId, item) {
        // User-owned, so this goes through the request-scoped client and RLS.
        const { error } = await db.from('food_cache').insert({
          kind: 'estimate',
          source: 'ai-photo-estimate',
          query: estimateId,
          user_id: userId,
          payload: item,
        });
        if (error) rethrow(error, 'foodCache.putEstimate');
      },
    },

    // =======================================================================
    // body_measurements — offline-syncable
    // =======================================================================
    bodyMeasurements: {
      async list(userId, limit) {
        const { data, error } = await db
          .from('body_measurements')
          .select('*')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(limit ?? 365);
        if (error) rethrow(error, 'bodyMeasurements.list');
        return asRows(data).map(toBodyMeasurement);
      },

      async listByRange(userId, fromDate, toDate) {
        const { data, error } = await db
          .from('body_measurements')
          .select('*')
          .eq('user_id', userId)
          .gte('date', fromDate)
          .lte('date', toDate)
          .order('date');
        if (error) rethrow(error, 'bodyMeasurements.listByRange');
        return asRows(data).map(toBodyMeasurement);
      },

      async findByClientId(userId, clientId) {
        const { data, error } = await db
          .from('body_measurements')
          .select('*')
          .eq('user_id', userId)
          .eq('client_id', clientId)
          .maybeSingle();
        if (error) rethrow(error, 'bodyMeasurements.findByClientId');
        const row = asRow(data);
        return row ? toBodyMeasurement(row) : null;
      },

      async insert(userId, input) {
        const { data, error } = await db
          .from('body_measurements')
          .insert({
            user_id: userId,
            client_id: input.clientId,
            date: input.date,
            weight_kg: input.weightKg,
            body_fat_pct: input.bodyFatPct ?? null,
            tape_cm: input.tapeCm ?? null,
            notes: input.notes ?? null,
          })
          .select('*')
          .single();
        if (error) rethrow(error, 'bodyMeasurements.insert');
        const row = asRow(data);
        if (!row) throw internal('bodyMeasurements.insert returned no row');
        return toBodyMeasurement(row);
      },

      async findLatest(userId) {
        // Ordered by date then created_at, so several entries on one day resolve to
        // the most recently recorded — the same rule the trend engine applies.
        const { data, error } = await db
          .from('body_measurements')
          .select('*')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) rethrow(error, 'bodyMeasurements.findLatest');
        const row = asRow(data);
        return row ? toBodyMeasurement(row) : null;
      },
    },

    // =======================================================================
    // body_comp_evaluations — server-owned async state
    // =======================================================================
    evaluations: {
      async findLatest(userId) {
        const { data, error } = await db
          .from('body_comp_evaluations')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) rethrow(error, 'evaluations.findLatest');
        const row = asRow(data);
        return row ? toEvaluationRow(row) : null;
      },

      async findById(userId, id) {
        const { data, error } = await db
          .from('body_comp_evaluations')
          .select('*')
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle();
        if (error) rethrow(error, 'evaluations.findById');
        const row = asRow(data);
        return row ? toEvaluationRow(row) : null;
      },

      async insertPending(row) {
        const { data, error } = await db
          .from('body_comp_evaluations')
          .insert({
            user_id: row.userId,
            measurement_id: row.measurementId,
            status: 'pending',
            // Written before the AI call, so the deterministic numbers are durable
            // even if the provider never answers.
            trend: row.trend,
          })
          .select('*')
          .single();
        if (error) rethrow(error, 'evaluations.insertPending');
        const created = asRow(data);
        if (!created) throw internal('evaluations.insertPending returned no row');
        return toEvaluationRow(created);
      },

      async claimForRun(id, staleBefore, maxAttempts) {
        // Read the current attempt count first so the update can be conditional on
        // it. The .eq('attempts', ...) below is what makes the claim atomic: a
        // concurrent claimer changes the count, so only one update matches a row.
        const { data: current, error: readError } = await db
          .from('body_comp_evaluations')
          .select('attempts, status, started_at, created_at')
          .eq('id', id)
          .maybeSingle();
        if (readError) rethrow(readError, 'evaluations.claimForRun.read');

        const row = asRow(current);
        if (!row || row.status !== 'pending') return null;

        const attempts = typeof row.attempts === 'number' ? row.attempts : 0;
        if (attempts >= maxAttempts) return null;

        const since = Date.parse(
          (typeof row.started_at === 'string' ? row.started_at : null) ??
            (typeof row.created_at === 'string' ? row.created_at : ''),
        );
        if (Number.isFinite(since) && since >= staleBefore.getTime()) return null;

        const { data, error } = await db
          .from('body_comp_evaluations')
          .update({ attempts: attempts + 1, started_at: ctx.clock().toISOString() })
          .eq('id', id)
          .eq('status', 'pending')
          .eq('attempts', attempts)
          .select('*')
          .maybeSingle();
        if (error) rethrow(error, 'evaluations.claimForRun');
        const claimed = asRow(data);
        return claimed ? toEvaluationRow(claimed) : null;
      },

      async markReady(id, summary, provider, model) {
        // Conditional on status still being pending, so only one runner wins the
        // transition and the evaluation-ready notification fires exactly once.
        const { data, error } = await db
          .from('body_comp_evaluations')
          .update({
            status: 'ready',
            summary,
            provider,
            model,
            completed_at: ctx.clock().toISOString(),
          })
          .eq('id', id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();
        if (error) rethrow(error, 'evaluations.markReady');
        return asRow(data) !== null;
      },

      async markFailed(id, errorCode) {
        const { data, error } = await db
          .from('body_comp_evaluations')
          .update({
            status: 'failed',
            error_code: errorCode,
            completed_at: ctx.clock().toISOString(),
          })
          .eq('id', id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();
        if (error) rethrow(error, 'evaluations.markFailed');
        return asRow(data) !== null;
      },
    },

    // =======================================================================
    // push_subscriptions
    // =======================================================================
    pushSubscriptions: {
      async listPlayerIds(userId) {
        const { data, error } = await db
          .from('push_subscriptions')
          .select('player_id')
          .eq('user_id', userId);
        if (error) rethrow(error, 'pushSubscriptions.listPlayerIds');
        return asRows(data)
          .map((row) => (typeof row.player_id === 'string' ? row.player_id : ''))
          .filter(Boolean);
      },

      async upsert(userId, playerId) {
        const { data, error } = await db
          .from('push_subscriptions')
          .upsert({ user_id: userId, player_id: playerId }, { onConflict: 'user_id,player_id' })
          .select('*')
          .single();
        if (error) rethrow(error, 'pushSubscriptions.upsert');
        const row = asRow(data);
        if (!row) throw internal('pushSubscriptions.upsert returned no row');
        return toPushSubscription(row);
      },
    },

    // =======================================================================
    // subscriptions — billing placeholder
    // =======================================================================
    subscriptions: {
      async ensureFree(userId) {
        const { data, error } = await db
          .from('subscriptions')
          .upsert(
            { user_id: userId, plan: 'free', is_premium: false },
            { onConflict: 'user_id', ignoreDuplicates: true },
          )
          .select('*')
          .maybeSingle();
        if (error) rethrow(error, 'subscriptions.ensureFree');
        const row = asRow(data);
        // ignoreDuplicates returns nothing when the row already existed, which is
        // success, not failure: the plan is free either way.
        return row ? toSubscriptionStatus(row) : { plan: 'free', isPremium: false };
      },

      async find(userId) {
        const { data, error } = await db
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (error) rethrow(error, 'subscriptions.find');
        const row = asRow(data);
        return row ? toSubscriptionStatus(row) : null;
      },
    },
  };
}

/** Re-exported for the seed script, which needs the row type but not a request. */
export type { EvaluationRow, UserRow };
