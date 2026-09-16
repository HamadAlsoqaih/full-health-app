/**
 * Row mapping between Postgres snake_case and the camelCase wire types.
 *
 * Written by hand rather than generated so each conversion is visible — notably
 * the numeric ones. Postgres `numeric` arrives from PostgREST as a STRING to avoid
 * float precision loss, so every macro and weight has to be parsed. Passing those
 * through unconverted is how "2000" + "500" becomes "2000500" in a daily total.
 */
import type {
  BodyMeasurement,
  CustomFood,
  Exercise,
  FoodLogEntry,
  FoodSource,
  MuscleGroup,
  PushSubscription,
  Routine,
  RoutineExercise,
  SubscriptionStatus,
  WorkoutLog,
  PerformedExercise,
} from '@app/shared-types';
import type { EvaluationRow, FoodCacheRow, UserRow } from '../../models/index.js';

type Row = Record<string, unknown>;

/** Postgres numeric arrives as a string; anything unparseable becomes 0. */
const num = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const optNum = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  return num(value);
};

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const optStr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export const toUserRow = (row: Row): UserRow => ({
  id: str(row.id),
  email: str(row.email),
  displayName: typeof row.display_name === 'string' ? row.display_name : null,
  onboardingComplete: row.onboarding_complete === true,
  goals: row.goals ?? null,
  units: row.units === 'imperial' ? 'imperial' : 'metric',
  preferences: row.preferences ?? {},
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const toExercise = (row: Row): Exercise => ({
  id: str(row.id),
  name: str(row.name),
  muscleGroup: str(row.muscle_group) as MuscleGroup,
  secondaryMuscles: Array.isArray(row.secondary_muscles)
    ? (row.secondary_muscles as MuscleGroup[])
    : [],
  category: str(row.category) as Exercise['category'],
  level: str(row.level) as Exercise['level'],
  instructions: Array.isArray(row.instructions) ? (row.instructions as string[]) : [],
  ...(optStr(row.equipment) ? { equipment: str(row.equipment) } : {}),
  ...(optStr(row.media_url) ? { mediaUrl: str(row.media_url) } : {}),
});

export const toRoutine = (row: Row): Routine => ({
  id: str(row.id),
  name: str(row.name),
  exercises: Array.isArray(row.exercises) ? (row.exercises as RoutineExercise[]) : [],
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export const toWorkoutLog = (row: Row): WorkoutLog => ({
  id: str(row.id),
  clientId: str(row.client_id),
  routineId: typeof row.routine_id === 'string' ? row.routine_id : null,
  routineName: str(row.routine_name),
  completedAt: str(row.completed_at),
  performed: Array.isArray(row.performed) ? (row.performed as PerformedExercise[]) : [],
  createdAt: str(row.created_at),
  ...(optNum(row.duration_seconds) !== undefined
    ? { durationSeconds: num(row.duration_seconds) }
    : {}),
  ...(optStr(row.notes) ? { notes: str(row.notes) } : {}),
});

export const toCustomFood = (row: Row): CustomFood => ({
  id: str(row.id),
  clientId: str(row.client_id),
  name: str(row.name),
  servingLabel: str(row.serving_label) || '1 serving',
  calories: num(row.calories),
  proteinG: num(row.protein_g),
  carbsG: num(row.carbs_g),
  fatG: num(row.fat_g),
  createdAt: str(row.created_at),
  ...(optStr(row.brand) ? { brand: str(row.brand) } : {}),
  ...(optNum(row.fiber_g) !== undefined ? { fiberG: num(row.fiber_g) } : {}),
});

export const toFoodLogEntry = (row: Row): FoodLogEntry => ({
  id: str(row.id),
  clientId: str(row.client_id),
  date: str(row.date),
  foodItemId: str(row.food_item_id),
  foodName: str(row.food_name),
  source: str(row.source) as FoodSource,
  servingLabel: str(row.serving_label) || '1 serving',
  servingMultiplier: num(row.serving_multiplier),
  baseCalories: num(row.base_calories),
  baseProteinG: num(row.base_protein_g),
  baseCarbsG: num(row.base_carbs_g),
  baseFatG: num(row.base_fat_g),
  // Generated stored columns; parsed like any other numeric.
  calories: num(row.calories),
  proteinG: num(row.protein_g),
  carbsG: num(row.carbs_g),
  fatG: num(row.fat_g),
  loggedAt: str(row.logged_at),
  ...(optStr(row.meal) ? { meal: str(row.meal) as FoodLogEntry['meal'] } : {}),
});

export const toBodyMeasurement = (row: Row): BodyMeasurement => ({
  id: str(row.id),
  clientId: str(row.client_id),
  date: str(row.date),
  weightKg: num(row.weight_kg),
  createdAt: str(row.created_at),
  ...(optNum(row.body_fat_pct) !== undefined ? { bodyFatPct: num(row.body_fat_pct) } : {}),
  ...(row.tape_cm ? { tapeCm: row.tape_cm as BodyMeasurement['tapeCm'] } : {}),
  ...(optStr(row.notes) ? { notes: str(row.notes) } : {}),
});

export const toEvaluationRow = (row: Row): EvaluationRow => ({
  id: str(row.id),
  userId: str(row.user_id),
  measurementId: str(row.measurement_id),
  status: str(row.status) as EvaluationRow['status'],
  trend: row.trend as EvaluationRow['trend'],
  summary: typeof row.summary === 'string' ? row.summary : null,
  provider: typeof row.provider === 'string' ? row.provider : null,
  model: typeof row.model === 'string' ? row.model : null,
  errorCode: typeof row.error_code === 'string' ? row.error_code : null,
  attempts: num(row.attempts),
  createdAt: str(row.created_at),
  startedAt: typeof row.started_at === 'string' ? row.started_at : null,
  completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
});

export const toFoodCacheRow = (row: Row): FoodCacheRow => ({
  id: str(row.id),
  kind: str(row.kind) as FoodCacheRow['kind'],
  source: str(row.source) as FoodSource,
  query: str(row.query),
  userId: typeof row.user_id === 'string' ? row.user_id : null,
  payload: row.payload as FoodCacheRow['payload'],
  fetchedAt: str(row.fetched_at),
});

export const toPushSubscription = (row: Row): PushSubscription => ({
  id: str(row.id),
  playerId: str(row.player_id),
  createdAt: str(row.created_at),
});

export const toSubscriptionStatus = (row: Row): SubscriptionStatus => ({
  plan: row.plan === 'premium' ? 'premium' : 'free',
  isPremium: row.is_premium === true,
  ...(optStr(row.renews_at) ? { renewsAt: str(row.renews_at) } : {}),
});
