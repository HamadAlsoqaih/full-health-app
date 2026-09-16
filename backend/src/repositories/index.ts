/**
 * Repository interfaces — one per table, domain-shaped rather than mirroring
 * Supabase's query builder.
 *
 * Two rules hold for every implementation:
 *
 *  1. Every method takes `userId` and filters on it, EVEN THOUGH row-level security
 *     already enforces the same thing. RLS is the layer the credential-free test
 *     suite cannot cover, so it must never be the only defence. Defence in depth is
 *     the whole point; a forgotten filter should be a bug, not a breach.
 *
 *  2. Inserts on offline-syncable tables surface a unique violation rather than
 *     swallowing it, so the service layer can convert a replayed write into the
 *     stored row. See middlewares/idempotency.middleware.ts.
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
  MuscleGroup,
  PushSubscription,
  Routine,
  RoutineInput,
  SubscriptionStatus,
  WorkoutLog,
  WorkoutLogInput,
} from '@app/shared-types';
import type { EvaluationRow, FoodCacheRow, NewEvaluation, UserRow } from '../models/index.js';
import type { DatabaseHandle } from '../ports.js';

/** What a repository set is built from, once per request. */
export interface RepositoryContext {
  /** Carries the caller's JWT in production, so RLS applies. */
  db: DatabaseHandle;
  clock: () => Date;
  uuid: () => string;
}

export interface UserRepository {
  findById(userId: string): Promise<UserRow | null>;
  /**
   * Creates the public mirror of an auth user, or refreshes its email.
   * Idempotent, because it is called from register, login and getMe — OAuth never
   * touches register, so creation cannot live there alone.
   */
  ensure(userId: string, email: string): Promise<UserRow>;
  update(userId: string, patch: Partial<UserRow>): Promise<UserRow>;
  /** True when at least one body measurement exists: the onboarding stats signal. */
  hasAnyMeasurement(userId: string): Promise<boolean>;
}

export interface ExerciseRepository {
  list(filter?: { muscleGroup?: MuscleGroup; search?: string }): Promise<Exercise[]>;
  findById(id: string): Promise<Exercise | null>;
  /** Used by the seed script. Upserts on the upstream slug so re-runs are safe. */
  upsertMany(exercises: Array<Omit<Exercise, 'id'> & { externalId: string }>): Promise<number>;
}

export interface RoutineRepository {
  list(userId: string): Promise<Routine[]>;
  findById(userId: string, id: string): Promise<Routine | null>;
  create(userId: string, input: RoutineInput): Promise<Routine>;
  update(userId: string, id: string, patch: Partial<RoutineInput>): Promise<Routine>;
  remove(userId: string, id: string): Promise<void>;
}

export interface WorkoutLogRepository {
  list(userId: string, limit?: number): Promise<WorkoutLog[]>;
  /** The idempotency lookup. Scoped by user, so a foreign key simply misses. */
  findByClientId(userId: string, clientId: string): Promise<WorkoutLog | null>;
  insert(userId: string, input: WorkoutLogInput): Promise<WorkoutLog>;
  findLatest(userId: string): Promise<WorkoutLog | null>;
}

export interface CustomFoodRepository {
  list(userId: string): Promise<CustomFood[]>;
  findById(userId: string, id: string): Promise<CustomFood | null>;
  findByClientId(userId: string, clientId: string): Promise<CustomFood | null>;
  insert(userId: string, input: CustomFoodInput): Promise<CustomFood>;
  search(userId: string, query: string): Promise<CustomFood[]>;
}

export interface FoodLogRepository {
  listByDate(userId: string, date: string): Promise<FoodLogEntry[]>;
  /** Inclusive date range, used by the trend engine and the overview. */
  listByRange(userId: string, fromDate: string, toDate: string): Promise<FoodLogEntry[]>;
  findByClientId(userId: string, clientId: string): Promise<FoodLogEntry | null>;
  insert(userId: string, row: NewFoodLogRow): Promise<FoodLogEntry>;
  remove(userId: string, id: string): Promise<void>;
}

/** Resolved macros, ready to store. The service resolves foodItemId before this. */
export interface NewFoodLogRow {
  clientId: string;
  date: string;
  foodItemId: string;
  foodName: string;
  source: FoodSource;
  servingLabel: string;
  servingMultiplier: number;
  baseCalories: number;
  baseProteinG: number;
  baseCarbsG: number;
  baseFatG: number;
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
}

export interface FoodCacheRepository {
  /** Returns null for a miss OR for a row older than the configured TTL. */
  get(kind: 'search' | 'item', source: FoodSource, query: string): Promise<FoodCacheRow | null>;
  put(row: Omit<FoodCacheRow, 'id' | 'fetchedAt'>): Promise<FoodCacheRow>;
  /** AI photo estimates live here, owned by the user who produced them. */
  getEstimate(userId: string, estimateId: string): Promise<FoodItem | null>;
  putEstimate(userId: string, estimateId: string, item: FoodItem): Promise<void>;
}

export interface BodyMeasurementRepository {
  list(userId: string, limit?: number): Promise<BodyMeasurement[]>;
  listByRange(userId: string, fromDate: string, toDate: string): Promise<BodyMeasurement[]>;
  findByClientId(userId: string, clientId: string): Promise<BodyMeasurement | null>;
  insert(userId: string, input: BodyMeasurementInput): Promise<BodyMeasurement>;
  findLatest(userId: string): Promise<BodyMeasurement | null>;
}

export interface EvaluationRepository {
  findLatest(userId: string): Promise<EvaluationRow | null>;
  findById(userId: string, id: string): Promise<EvaluationRow | null>;
  insertPending(row: NewEvaluation): Promise<EvaluationRow>;
  /**
   * Atomically claims a pending evaluation for work.
   *
   * Returns the row only if it was still pending, under the attempt ceiling, and
   * stale enough to retry. A conditional update rather than read-then-write, so
   * concurrent polls cannot double-fire the AI call or double-send the
   * notification.
   */
  claimForRun(id: string, staleBefore: Date, maxAttempts: number): Promise<EvaluationRow | null>;
  /** Transitions pending → ready. Returns false if something else got there first. */
  markReady(id: string, summary: string, provider: string, model: string): Promise<boolean>;
  markFailed(id: string, errorCode: string): Promise<boolean>;
}

export interface PushSubscriptionRepository {
  listPlayerIds(userId: string): Promise<string[]>;
  upsert(userId: string, playerId: string): Promise<PushSubscription>;
}

export interface SubscriptionRepository {
  /** Idempotent. Exercised by its test; not called during registration. */
  ensureFree(userId: string): Promise<SubscriptionStatus>;
  find(userId: string): Promise<SubscriptionStatus | null>;
}

export interface Repositories {
  users: UserRepository;
  exercises: ExerciseRepository;
  routines: RoutineRepository;
  workoutLogs: WorkoutLogRepository;
  customFoods: CustomFoodRepository;
  foodLog: FoodLogRepository;
  foodCache: FoodCacheRepository;
  bodyMeasurements: BodyMeasurementRepository;
  evaluations: EvaluationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  subscriptions: SubscriptionRepository;
}
