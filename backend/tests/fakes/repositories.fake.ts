/**
 * In-memory Repositories, array-backed.
 *
 * These exist instead of `vi.mock('@supabase/supabase-js')` because a mocked client
 * cannot hold state across requests, and the offline-sync test fundamentally needs
 * the second POST to see the row the first POST created.
 *
 * Two behaviours are faithful to Postgres on purpose, because tests depend on them:
 *
 *  - A duplicate (userId, clientId) insert throws `{ code: '23505' }`, the same
 *    unique-violation code the real driver reports, so the idempotency path is
 *    exercised rather than bypassed.
 *  - `claimForRun` is conditional, matching the real atomic UPDATE ... RETURNING, so
 *    a double-poll cannot double-fire the AI call here either.
 */
import type {
  BodyMeasurement,
  BodyMeasurementInput,
  CustomFood,
  CustomFoodInput,
  Exercise,
  FoodItem,
  FoodLogEntry,
  FoodSource,
  PushSubscription,
  Routine,
  SubscriptionStatus,
  WorkoutLog,
  WorkoutLogInput,
} from '@app/shared-types';
import type {
  EvaluationRow,
  FoodCacheRow,
  NewEvaluation,
  UserRow,
} from '../../src/models/index.js';
import type {
  NewFoodLogRow,
  Repositories,
  RepositoryContext,
} from '../../src/repositories/index.js';

/** The unique-violation the real database raises. */
export function uniqueViolation(constraint: string): Error & { code: string } {
  const err = new Error(
    `duplicate key value violates unique constraint "${constraint}"`,
  ) as Error & {
    code: string;
  };
  err.code = '23505';
  return err;
}

/** Mutable store, exposed so a test can seed fixtures or assert on raw rows. */
export interface FakeStore {
  users: UserRow[];
  exercises: Array<Exercise & { externalId: string }>;
  routines: Array<Routine & { userId: string }>;
  workoutLogs: Array<WorkoutLog & { userId: string }>;
  customFoods: Array<CustomFood & { userId: string }>;
  foodLog: Array<FoodLogEntry & { userId: string }>;
  foodCache: FoodCacheRow[];
  bodyMeasurements: Array<BodyMeasurement & { userId: string }>;
  evaluations: EvaluationRow[];
  pushSubscriptions: Array<PushSubscription & { userId: string }>;
  subscriptions: Array<SubscriptionStatus & { userId: string; id: string }>;
}

export function createFakeStore(): FakeStore {
  return {
    users: [],
    exercises: [],
    routines: [],
    workoutLogs: [],
    customFoods: [],
    foodLog: [],
    foodCache: [],
    bodyMeasurements: [],
    evaluations: [],
    pushSubscriptions: [],
    subscriptions: [],
  };
}

const clone = <T>(value: T): T => structuredClone(value);
/** Strips the ownership column, so a fake cannot accidentally leak it to a caller. */
const strip = <T extends { userId: string }>(row: T): Omit<T, 'userId'> => {
  const { userId: _userId, ...rest } = row;
  return clone(rest) as Omit<T, 'userId'>;
};

export function createFakeRepositories(store: FakeStore, ctx: RepositoryContext): Repositories {
  const now = () => ctx.clock().toISOString();

  return {
    users: {
      async findById(userId) {
        return store.users.find((u) => u.id === userId) ?? null;
      },
      async ensure(userId, email) {
        const existing = store.users.find((u) => u.id === userId);
        if (existing) {
          existing.email = email;
          return clone(existing);
        }
        const row: UserRow = {
          id: userId,
          email,
          displayName: null,
          onboardingComplete: false,
          goals: null,
          units: 'metric',
          preferences: {},
          createdAt: now(),
          updatedAt: now(),
        };
        store.users.push(row);
        return clone(row);
      },
      async update(userId, patch) {
        const row = store.users.find((u) => u.id === userId);
        if (!row) throw new Error(`fake: no user ${userId}`);
        Object.assign(row, patch, { updatedAt: now() });
        return clone(row);
      },
      async hasAnyMeasurement(userId) {
        return store.bodyMeasurements.some((m) => m.userId === userId);
      },
    },

    exercises: {
      async list(filter) {
        let rows = store.exercises;
        if (filter?.muscleGroup) {
          rows = rows.filter((e) => e.muscleGroup === filter.muscleGroup);
        }
        if (filter?.search) {
          const q = filter.search.toLowerCase();
          rows = rows.filter((e) => e.name.toLowerCase().includes(q));
        }
        return rows.map((e) => clone(e));
      },
      async findById(id) {
        return clone(store.exercises.find((e) => e.id === id) ?? null);
      },
      async upsertMany(exercises) {
        let written = 0;
        for (const ex of exercises) {
          const existing = store.exercises.find((e) => e.externalId === ex.externalId);
          if (existing) {
            Object.assign(existing, ex);
          } else {
            store.exercises.push({ ...clone(ex), id: ctx.uuid() } as Exercise & {
              externalId: string;
            });
          }
          written += 1;
        }
        return written;
      },
    },

    routines: {
      async list(userId) {
        return store.routines.filter((r) => r.userId === userId).map((r) => strip(r) as Routine);
      },
      async findById(userId, id) {
        const row = store.routines.find((r) => r.userId === userId && r.id === id);
        return row ? (strip(row) as Routine) : null;
      },
      async create(userId, input) {
        const row = {
          id: ctx.uuid(),
          userId,
          name: input.name,
          exercises: clone(input.exercises),
          createdAt: now(),
          updatedAt: now(),
        };
        store.routines.push(row);
        return strip(row) as Routine;
      },
      async update(userId, id, patch) {
        const row = store.routines.find((r) => r.userId === userId && r.id === id);
        if (!row) throw new Error(`fake: no routine ${id}`);
        if (patch.name !== undefined) row.name = patch.name;
        if (patch.exercises !== undefined) row.exercises = clone(patch.exercises);
        row.updatedAt = now();
        return strip(row) as Routine;
      },
      async remove(userId, id) {
        const i = store.routines.findIndex((r) => r.userId === userId && r.id === id);
        if (i >= 0) store.routines.splice(i, 1);
        // Mirrors ON DELETE SET NULL: history survives, the reference does not.
        for (const log of store.workoutLogs) {
          if (log.routineId === id) log.routineId = null;
        }
      },
    },

    workoutLogs: {
      async list(userId, limit) {
        const rows = store.workoutLogs
          .filter((w) => w.userId === userId)
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
          .map((w) => strip(w) as WorkoutLog);
        return limit ? rows.slice(0, limit) : rows;
      },
      async findByClientId(userId, clientId) {
        const row = store.workoutLogs.find((w) => w.userId === userId && w.clientId === clientId);
        return row ? (strip(row) as WorkoutLog) : null;
      },
      async insert(userId, input: WorkoutLogInput) {
        if (store.workoutLogs.some((w) => w.userId === userId && w.clientId === input.clientId)) {
          throw uniqueViolation('workout_logs_user_client_unique');
        }
        const row = {
          id: ctx.uuid(),
          userId,
          clientId: input.clientId,
          routineId: input.routineId,
          routineName: input.routineName,
          completedAt: input.completedAt,
          performed: clone(input.performed),
          createdAt: now(),
          ...(input.durationSeconds !== undefined
            ? { durationSeconds: input.durationSeconds }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        };
        store.workoutLogs.push(row);
        return strip(row) as WorkoutLog;
      },
      async findLatest(userId) {
        const row = store.workoutLogs
          .filter((w) => w.userId === userId)
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
        return row ? (strip(row) as WorkoutLog) : null;
      },
    },

    customFoods: {
      async list(userId) {
        return store.customFoods
          .filter((c) => c.userId === userId)
          .map((c) => strip(c) as CustomFood);
      },
      async findById(userId, id) {
        const row = store.customFoods.find((c) => c.userId === userId && c.id === id);
        return row ? (strip(row) as CustomFood) : null;
      },
      async findByClientId(userId, clientId) {
        const row = store.customFoods.find((c) => c.userId === userId && c.clientId === clientId);
        return row ? (strip(row) as CustomFood) : null;
      },
      async insert(userId, input: CustomFoodInput) {
        if (store.customFoods.some((c) => c.userId === userId && c.clientId === input.clientId)) {
          throw uniqueViolation('custom_foods_user_client_unique');
        }
        const row = {
          id: ctx.uuid(),
          userId,
          clientId: input.clientId,
          name: input.name,
          servingLabel: input.servingLabel ?? '1 serving',
          calories: input.calories,
          proteinG: input.proteinG,
          carbsG: input.carbsG,
          fatG: input.fatG,
          createdAt: now(),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.fiberG !== undefined ? { fiberG: input.fiberG } : {}),
        };
        store.customFoods.push(row);
        return strip(row) as CustomFood;
      },
      async search(userId, query) {
        const q = query.toLowerCase();
        return store.customFoods
          .filter((c) => c.userId === userId && c.name.toLowerCase().includes(q))
          .map((c) => strip(c) as CustomFood);
      },
    },

    foodLog: {
      async listByDate(userId, date) {
        return store.foodLog
          .filter((f) => f.userId === userId && f.date === date)
          .map((f) => strip(f) as FoodLogEntry);
      },
      async listByRange(userId, fromDate, toDate) {
        return store.foodLog
          .filter((f) => f.userId === userId && f.date >= fromDate && f.date <= toDate)
          .map((f) => strip(f) as FoodLogEntry);
      },
      async findByClientId(userId, clientId) {
        const row = store.foodLog.find((f) => f.userId === userId && f.clientId === clientId);
        return row ? (strip(row) as FoodLogEntry) : null;
      },
      async insert(userId, input: NewFoodLogRow) {
        if (store.foodLog.some((f) => f.userId === userId && f.clientId === input.clientId)) {
          throw uniqueViolation('food_log_user_client_unique');
        }
        // Matches the GENERATED STORED columns in the migration.
        const m = input.servingMultiplier;
        const row = {
          id: ctx.uuid(),
          userId,
          clientId: input.clientId,
          date: input.date,
          foodItemId: input.foodItemId,
          foodName: input.foodName,
          source: input.source,
          servingLabel: input.servingLabel,
          servingMultiplier: m,
          baseCalories: input.baseCalories,
          baseProteinG: input.baseProteinG,
          baseCarbsG: input.baseCarbsG,
          baseFatG: input.baseFatG,
          calories: input.baseCalories * m,
          proteinG: input.baseProteinG * m,
          carbsG: input.baseCarbsG * m,
          fatG: input.baseFatG * m,
          loggedAt: now(),
          ...(input.meal !== undefined ? { meal: input.meal } : {}),
        };
        store.foodLog.push(row);
        return strip(row) as FoodLogEntry;
      },
      async remove(userId, id) {
        const i = store.foodLog.findIndex((f) => f.userId === userId && f.id === id);
        if (i >= 0) store.foodLog.splice(i, 1);
      },
    },

    foodCache: {
      async get(kind, source: FoodSource, query) {
        const row = store.foodCache.find(
          (c) => c.kind === kind && c.source === source && c.query === query,
        );
        return row ? clone(row) : null;
      },
      async put(row) {
        const existing = store.foodCache.find(
          (c) => c.kind === row.kind && c.source === row.source && c.query === row.query,
        );
        if (existing) {
          existing.payload = clone(row.payload);
          existing.fetchedAt = now();
          return clone(existing);
        }
        const created: FoodCacheRow = { ...clone(row), id: ctx.uuid(), fetchedAt: now() };
        store.foodCache.push(created);
        return clone(created);
      },
      async getEstimate(userId, estimateId) {
        const row = store.foodCache.find(
          (c) => c.kind === 'estimate' && c.query === estimateId && c.userId === userId,
        );
        return row ? (clone(row.payload) as FoodItem) : null;
      },
      async putEstimate(userId, estimateId, item) {
        store.foodCache.push({
          id: ctx.uuid(),
          kind: 'estimate',
          source: 'ai-photo-estimate',
          query: estimateId,
          userId,
          payload: clone(item),
          fetchedAt: now(),
        });
      },
    },

    bodyMeasurements: {
      async list(userId, limit) {
        const rows = store.bodyMeasurements
          .filter((m) => m.userId === userId)
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((m) => strip(m) as BodyMeasurement);
        return limit ? rows.slice(0, limit) : rows;
      },
      async listByRange(userId, fromDate, toDate) {
        return store.bodyMeasurements
          .filter((m) => m.userId === userId && m.date >= fromDate && m.date <= toDate)
          .map((m) => strip(m) as BodyMeasurement);
      },
      async findByClientId(userId, clientId) {
        const row = store.bodyMeasurements.find(
          (m) => m.userId === userId && m.clientId === clientId,
        );
        return row ? (strip(row) as BodyMeasurement) : null;
      },
      async insert(userId, input: BodyMeasurementInput) {
        if (
          store.bodyMeasurements.some((m) => m.userId === userId && m.clientId === input.clientId)
        ) {
          throw uniqueViolation('body_measurements_user_client_unique');
        }
        const row = {
          id: ctx.uuid(),
          userId,
          clientId: input.clientId,
          date: input.date,
          weightKg: input.weightKg,
          createdAt: now(),
          ...(input.bodyFatPct !== undefined ? { bodyFatPct: input.bodyFatPct } : {}),
          ...(input.tapeCm !== undefined ? { tapeCm: clone(input.tapeCm) } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        };
        store.bodyMeasurements.push(row);
        return strip(row) as BodyMeasurement;
      },
      async findLatest(userId) {
        const row = store.bodyMeasurements
          .filter((m) => m.userId === userId)
          // Same-day ties break on insertion order, matching "latest entry per day".
          .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
          .at(-1);
        return row ? (strip(row) as BodyMeasurement) : null;
      },
    },

    evaluations: {
      async findLatest(userId) {
        const row = store.evaluations
          .filter((e) => e.userId === userId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .at(-1);
        return row ? clone(row) : null;
      },
      async findById(userId, id) {
        const row = store.evaluations.find((e) => e.userId === userId && e.id === id);
        return row ? clone(row) : null;
      },
      async insertPending(row: NewEvaluation) {
        const created: EvaluationRow = {
          id: ctx.uuid(),
          userId: row.userId,
          measurementId: row.measurementId,
          status: 'pending',
          trend: clone(row.trend),
          summary: null,
          provider: null,
          model: null,
          errorCode: null,
          attempts: 0,
          createdAt: now(),
          startedAt: null,
          completedAt: null,
        };
        store.evaluations.push(created);
        return clone(created);
      },
      async claimForRun(id, staleBefore, maxAttempts) {
        const row = store.evaluations.find((e) => e.id === id);
        if (!row || row.status !== 'pending' || row.attempts >= maxAttempts) return null;
        const since = new Date(row.startedAt ?? row.createdAt);
        if (since >= staleBefore) return null;
        row.attempts += 1;
        row.startedAt = now();
        return clone(row);
      },
      async markReady(id, summary, provider, model) {
        const row = store.evaluations.find((e) => e.id === id);
        // Conditional, so only one concurrent runner can win the transition.
        if (!row || row.status !== 'pending') return false;
        row.status = 'ready';
        row.summary = summary;
        row.provider = provider;
        row.model = model;
        row.completedAt = now();
        return true;
      },
      async markFailed(id, errorCode) {
        const row = store.evaluations.find((e) => e.id === id);
        if (!row || row.status !== 'pending') return false;
        row.status = 'failed';
        row.errorCode = errorCode;
        row.completedAt = now();
        return true;
      },
    },

    pushSubscriptions: {
      async listPlayerIds(userId) {
        return store.pushSubscriptions.filter((p) => p.userId === userId).map((p) => p.playerId);
      },
      async upsert(userId, playerId) {
        const existing = store.pushSubscriptions.find(
          (p) => p.userId === userId && p.playerId === playerId,
        );
        if (existing) return strip(existing) as PushSubscription;
        const row = { id: ctx.uuid(), userId, playerId, createdAt: now() };
        store.pushSubscriptions.push(row);
        return strip(row) as PushSubscription;
      },
    },

    subscriptions: {
      async ensureFree(userId) {
        const existing = store.subscriptions.find((s) => s.userId === userId);
        if (existing) return { plan: existing.plan, isPremium: existing.isPremium };
        const row = { id: ctx.uuid(), userId, plan: 'free' as const, isPremium: false };
        store.subscriptions.push(row);
        return { plan: row.plan, isPremium: row.isPremium };
      },
      async find(userId) {
        const row = store.subscriptions.find((s) => s.userId === userId);
        return row ? { plan: row.plan, isPremium: row.isPremium } : null;
      },
    },
  };
}
