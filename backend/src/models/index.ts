/**
 * Backend-only row shapes.
 *
 * Each imports its wire type from @app/shared-types and extends it with fields the
 * client never sees — ownership, sync bookkeeping, service-role state (spec rule 1).
 * Nothing here redefines a field that already exists on the wire type.
 */
import type {
  BodyMeasurement,
  ComputedTrend,
  CustomFood,
  Exercise,
  FoodItem,
  FoodLogEntry,
  FoodSource,
  PushSubscription,
  Routine,
  SubscriptionStatus,
  TrendResult,
  WorkoutLog,
} from '@app/shared-types';

/** Fields present on every user-owned row. */
export interface Owned {
  userId: string;
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  onboardingComplete: boolean;
  goals: unknown | null;
  units: 'metric' | 'imperial';
  preferences: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseRow extends Exercise {
  /** Stable slug from the upstream dataset, so re-seeding is idempotent. */
  externalId: string;
  createdAt: string;
}

export interface RoutineRow extends Routine, Owned {}

export interface WorkoutLogRow extends WorkoutLog, Owned {
  /** When the row reached the server, as distinct from when the workout happened. */
  syncedAt: string;
}

export interface CustomFoodRow extends CustomFood, Owned {
  updatedAt: string;
}

export interface FoodLogRow extends FoodLogEntry, Owned {
  createdAt: string;
}

export interface BodyMeasurementRow extends BodyMeasurement, Owned {
  updatedAt: string;
}

export interface PushSubscriptionRow extends PushSubscription, Owned {}

export interface SubscriptionRow extends SubscriptionStatus, Owned {
  id: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Server-owned async state for the AI phrasing of a trend. Kept off
 * body_measurements because that row is client-writable and last-write-wins, so an
 * offline queue flush would clobber these fields.
 */
export interface EvaluationRow extends Owned {
  id: string;
  measurementId: string;
  status: 'pending' | 'ready' | 'failed';
  /** Computed deterministically and written before the AI call is made. */
  trend: TrendResult;
  summary: string | null;
  provider: string | null;
  model: string | null;
  errorCode: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** Cache row in front of the external food databases, and home for AI estimates. */
export interface FoodCacheRow {
  id: string;
  kind: 'search' | 'item' | 'estimate';
  source: FoodSource;
  query: string;
  /** Null for shared upstream data; set for a per-user AI estimate. */
  userId: string | null;
  payload: FoodItem | FoodItem[];
  fetchedAt: string;
}

/** Input to the evaluation insert, which happens synchronously with the measurement. */
export interface NewEvaluation {
  userId: string;
  measurementId: string;
  trend: ComputedTrend;
}
