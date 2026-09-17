/**
 * Wire types shared by frontend and backend — the single source of truth (spec rule 1).
 *
 * These describe what crosses the network, nothing else. Backend-only fields (database
 * bookkeeping, service-role concerns) extend these in backend/src/models/. Nothing here
 * may be duplicated in either workspace.
 *
 * Conventions that hold throughout:
 * - All measurements are stored and transmitted in metric (kg, cm). Unit preference is a
 *   display concern, converted at the UI edge only. See docs/DATA-MODEL.md.
 * - All timestamps are ISO 8601 strings in UTC. Plain calendar days are 'YYYY-MM-DD'.
 * - `clientId` is a UUID minted on the client, used as an idempotency key for writes that
 *   can be queued offline. See docs/OFFLINE.md.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable, machine-readable error codes. The frontend branches on these, never on
 * `message`, which is human-facing and may be reworded freely.
 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'FOOD_SOURCE_UNAVAILABLE'
  | 'AI_UNAVAILABLE'
  | 'AI_QUOTA_EXHAUSTED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CONFIGURATION_ERROR'
  | 'INTERNAL';

/** Every non-2xx response body has exactly this shape (spec §7). */
export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level detail, present only for VALIDATION_FAILED. */
    details?: Record<string, string[]>;
  };
}

// ---------------------------------------------------------------------------
// Units and measurement
// ---------------------------------------------------------------------------

export type UnitSystem = 'metric' | 'imperial';

/** Tape measurements, in centimetres. All optional — users log what they bother to. */
export interface TapeMeasurementsCm {
  neck?: number;
  chest?: number;
  waist?: number;
  hips?: number;
  thigh?: number;
  arm?: number;
  calf?: number;
}

// ---------------------------------------------------------------------------
// Goals, onboarding and the user
// ---------------------------------------------------------------------------

export type GoalType = 'cut' | 'bulk' | 'maintain';

export interface Goals {
  goal: GoalType;
  /** Optional during onboarding; the trend engine falls back to its own estimate. */
  targetCalories?: number;
  targetProteinG?: number;
  /** Intended rate of change per week, kg. Negative for a cut. */
  targetRateKgPerWeek?: number;
  /** Carried inside goals because onboarding step 4 has no endpoint of its own. */
  dietaryPrefs?: DietaryPreferences;
}

export interface DietaryPreferences {
  /** Free-form tags, e.g. 'halal', 'vegetarian', 'lactose-free'. */
  preferences: string[];
  allergies?: string[];
  /** True when the user explicitly skipped the step rather than answering it. */
  skipped: boolean;
}

/**
 * Server-derived onboarding progress. The client never asserts these — it reads them.
 *
 * Onboarding has no data model of its own (spec rule 11): progress is inferred from the
 * two domains it seeds. `goalsSubmitted` means users.goals is populated;
 * `startingStatsSubmitted` means at least one body-composition entry exists.
 * This is what makes resume-after-close possible. See docs/ARCHITECTURE.md.
 */
export interface OnboardingProgress {
  goalsSubmitted: boolean;
  startingStatsSubmitted: boolean;
  complete: boolean;
}

export interface NotificationPreferences {
  /** Remind me to log meals / workouts. */
  remindersEnabled: boolean;
  /** Tell me when an AI body-composition evaluation is ready. */
  evaluationReadyEnabled: boolean;
}

export interface AiPreferences {
  /** Master switch for every AI-backed feature. */
  enabled: boolean;
  /** Photo-to-calorie estimation. */
  photoScanEnabled: boolean;
  /** Plain-language phrasing of the deterministic body-comp trend. */
  evaluationEnabled: boolean;
}

export interface UserPreferences {
  notifications: NotificationPreferences;
  ai: AiPreferences;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  units: UnitSystem;
  goals?: Goals;
  preferences: UserPreferences;
  onboarding: OnboardingProgress;
  createdAt: string;
}

/**
 * The subset of AuthUser a client may change. `id`, `email` and everything under
 * `onboarding` are server-owned — accepting a partial AuthUser on PUT /users/me would
 * let a client mark its own onboarding complete and skip the flow.
 */
export interface UserUpdateInput {
  displayName?: string;
  units?: UnitSystem;
  /**
   * Nested groups are individually partial, matching the endpoint's schema: a
   * client may send one toggle without restating the rest, and the server merges
   * it over the stored values.
   */
  preferences?: {
    notifications?: Partial<NotificationPreferences>;
    ai?: Partial<AiPreferences>;
  };
  goals?: Goals;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Absolute expiry, epoch seconds. */
  expiresAt: number;
}

export interface AuthResult {
  user: AuthUser;
  session: AuthSession;
}

export interface CredentialsInput {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type MuscleGroup =
  | 'abdominals'
  | 'abductors'
  | 'adductors'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'forearms'
  | 'glutes'
  | 'hamstrings'
  | 'lats'
  | 'lower back'
  | 'middle back'
  | 'neck'
  | 'quadriceps'
  | 'shoulders'
  | 'traps'
  | 'triceps';

export type ExerciseCategory =
  | 'strength'
  | 'stretching'
  | 'plyometrics'
  | 'strongman'
  | 'powerlifting'
  | 'cardio'
  | 'olympic weightlifting';

export type ExerciseLevel = 'beginner' | 'intermediate' | 'expert';

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  category: ExerciseCategory;
  level: ExerciseLevel;
  equipment?: string;
  /** Always a URL. Exercise media is never stored as binary (spec rule 9). */
  mediaUrl?: string;
  instructions: string[];
}

/** A planned exercise inside a routine. */
export interface RoutineExercise {
  exerciseId: string;
  /** Denormalised so a routine still reads correctly if the library changes. */
  exerciseName: string;
  sets: number;
  /** Target reps per set. A range is expressed by the UI, stored as the lower bound. */
  targetReps: number;
  targetWeightKg?: number;
  restSeconds?: number;
  notes?: string;
}

export interface Routine {
  id: string;
  name: string;
  exercises: RoutineExercise[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineInput {
  name: string;
  exercises: RoutineExercise[];
}

/** One completed set, as actually performed. */
export interface PerformedSet {
  reps: number;
  weightKg?: number;
  /** True when the user logged the set but skipped it. */
  skipped?: boolean;
}

export interface PerformedExercise {
  exerciseId: string;
  exerciseName: string;
  sets: PerformedSet[];
}

/**
 * A finished workout. Records what was actually done, not merely that something was —
 * without `performed`, workout history could only ever render a list of dates.
 */
export interface WorkoutLog {
  id: string;
  clientId: string;
  /** Null once the routine it came from has been deleted; the snapshot below survives. */
  routineId: string | null;
  routineName: string;
  completedAt: string;
  durationSeconds?: number;
  performed: PerformedExercise[];
  notes?: string;
  createdAt: string;
}

export interface WorkoutLogInput {
  clientId: string;
  routineId: string | null;
  routineName: string;
  completedAt: string;
  durationSeconds?: number;
  performed: PerformedExercise[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export type FoodSource = 'usda' | 'open-food-facts' | 'ai-photo-estimate' | 'manual' | 'custom';

/**
 * Macros for one serving of a food, as described by its source.
 *
 * `id` is namespaced by source (`usda:2341234`, `off:3017620422003`, `custom:<uuid>`,
 * `estimate:<uuid>`, `manual:`) so a single server-side resolution path serves every
 * source. See docs/DATA-MODEL.md.
 */
export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  source: FoodSource;
  /** Human-readable serving this item's macros describe, e.g. '100 g', '1 medium'. */
  servingLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
}

export interface CustomFood {
  id: string;
  clientId: string;
  name: string;
  brand?: string;
  servingLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  createdAt: string;
}

export interface CustomFoodInput {
  clientId: string;
  name: string;
  brand?: string;
  servingLabel?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/**
 * One logged food on one day.
 *
 * Both the per-serving macros and the multiplier are kept: the multiplier so the entry
 * stays editable as "1.5 servings", and the resolved totals so daily sums and the
 * overview stay correct even if the upstream food record later changes or is deleted.
 */
export interface FoodLogEntry {
  id: string;
  clientId: string;
  /** 'YYYY-MM-DD' in the user's local day. */
  date: string;
  foodItemId: string;
  /** Snapshot: without it, deleting a custom food makes past days unreadable. */
  foodName: string;
  source: FoodSource;
  servingLabel: string;
  servingMultiplier: number;
  /** Per-serving values, before the multiplier. */
  baseCalories: number;
  baseProteinG: number;
  baseCarbsG: number;
  baseFatG: number;
  /** Resolved totals: base × servingMultiplier. */
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  meal?: MealSlot;
  loggedAt: string;
}

export interface FoodLogInput {
  clientId: string;
  foodItemId: string;
  date: string;
  servingMultiplier: number;
  meal?: MealSlot;
}

export interface NutritionSearchResult {
  query: string;
  items: FoodItem[];
  /** True when served from food_cache rather than a live upstream call (spec rule 6). */
  fromCache: boolean;
  /** Sources that could not be consulted, e.g. because no API key is configured. */
  unavailableSources: FoodSource[];
}

export interface DailyNutritionTotals {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  entryCount: number;
}

/**
 * Result of a meal-photo estimate.
 *
 * Confidence is deliberately coarse — a numeric score would imply precision the model
 * does not have. An estimate is never logged automatically (spec rule 3): the client
 * must present it for confirmation or adjustment first.
 */
/**
 * One thing the model could not tell from the photo, and the answers it accepts.
 *
 * These exist because a photograph does not contain what dominates the error in
 * a calorie estimate. Air-fried and deep-fried chicken look nearly identical and
 * differ by the oil the coating absorbed; a bucket shows only its top layer;
 * oil, butter and dressing are invisible. Two or three answers fix more than any
 * amount of better guessing at the pixels.
 */
export interface ScanQuestion {
  /** Stable within one scan, used to attach the answer. */
  id: string;
  question: string;
  /**
   * What can be chosen. Always ends with an explicit "Not sure": forcing a guess
   * between air-fried and deep-fried produces worse data than an honest unknown,
   * which the model can answer with a midpoint and a lowered confidence.
   */
  options: string[];
}

/**
 * One answer.
 *
 * Carries the question's own text as well as its id, because the questions are
 * never stored server-side — they are generated, shown, answered and discarded
 * within one scan. The model reads "How was this cooked? → Deep fried", and a
 * slug like "cooking-method" would tell it far less. `option` is null when the
 * question was left unanswered.
 */
export interface ScanAnswer {
  questionId: string;
  question: string;
  option: string | null;
}

export interface PhotoScanResult {
  estimate: FoodItem;
  confidence: 'low' | 'medium';
  /** What the model believed it saw, for the confirmation screen. */
  detectedItems: string[];
  /**
   * Follow-up questions, at most three. Absent or empty means the model had
   * nothing worth asking, or did not answer in a usable shape — in which case
   * the flow is exactly what it was before questions existed.
   */
  questions?: ScanQuestion[];
  /** Always false. Present so the contract is explicit rather than implied. */
  autoLogged: false;
}

/**
 * A second pass over the same photo, with the questions answered.
 *
 * The photo is sent again rather than the model working from its own earlier
 * description of it. Telling it "8 pieces" is only useful if it can look at the
 * bucket while recalculating — and a second look is also the only way it can
 * correct something the first pass got wrong, such as calling wings thighs.
 *
 * The image is re-sent from the browser, which still holds it. Nothing is stored
 * server-side between the two calls.
 */
export interface PhotoRefineInput {
  /** The estimate the first pass produced, so the model revises rather than restarts. */
  previousEstimateId: string;
  answers: ScanAnswer[];
  /** Anything the questions did not cover, in the user's own words. */
  note?: string;
}

/** The revised estimate, alongside what it replaced so the change is visible. */
export interface PhotoRefineResult {
  estimate: FoodItem;
  confidence: 'low' | 'medium';
  detectedItems: string[];
  /**
   * Calories before the answers were taken into account.
   *
   * Shown as "620 → 890" rather than replacing the number silently: without it
   * there is no way to tell whether answering was worth doing, and next time the
   * questions get skipped.
   */
  previousCalories: number;
  autoLogged: false;
}

// ---------------------------------------------------------------------------
// Body composition
// ---------------------------------------------------------------------------

export interface BodyMeasurement {
  id: string;
  clientId: string;
  date: string;
  weightKg: number;
  bodyFatPct?: number;
  tapeCm?: TapeMeasurementsCm;
  notes?: string;
  createdAt: string;
}

export interface BodyMeasurementInput {
  clientId: string;
  date: string;
  weightKg: number;
  bodyFatPct?: number;
  tapeCm?: TapeMeasurementsCm;
  notes?: string;
}

export type TrendDirection = 'gaining' | 'losing' | 'holding';

/** Why a trend could not be computed, so the UI can say what is still needed. */
export interface InsufficientTrendData {
  status: 'insufficient-data';
  reasons: Array<'not-enough-weight-entries' | 'span-too-short' | 'not-enough-food-logs'>;
  /** Days of further logging required before a trend can be produced. */
  daysNeeded: number;
  weightEntryCount: number;
  daysWithFoodLogs: number;
}

/**
 * A computed trend. Always deterministic arithmetic — never AI (spec rule 4).
 * `ai-evaluation` only rephrases this; it never produces or alters the numbers.
 */
export interface ComputedTrend {
  status: 'ok';
  /** Window actually analysed. */
  fromDate: string;
  toDate: string;
  days: number;
  startWeightKg: number;
  endWeightKg: number;
  weightChangeKg: number;
  /** Least-squares slope over the window, kg per week. */
  ratePerWeekKg: number;
  direction: TrendDirection;
  /** Mean daily intake across days that have any food logged. */
  avgDailyCalories: number;
  avgDailyProteinG: number;
  daysWithFoodLogs: number;
  /** Intake implied by the observed weight change, from the 7700 kcal/kg convention. */
  estimatedMaintenanceCalories: number;
  /** Deterministic, rule-derived advice. Phrasing for display comes from the AI layer. */
  recommendation: TrendRecommendation;
}

export type TrendResult = ComputedTrend | InsufficientTrendData;

export type TrendAction =
  | 'increase-calories'
  | 'reduce-calories'
  | 'hold-calories'
  | 'increase-protein'
  | 'log-more-consistently';

export interface TrendRecommendation {
  /** Primary action; further actions may accompany it. */
  action: TrendAction;
  secondaryActions: TrendAction[];
  /** Suggested daily calorie delta, kcal. Negative means reduce. */
  calorieDeltaPerDay: number;
  /** Suggested daily protein floor, grams. */
  proteinTargetG?: number;
  /** Deterministic explanation of why, independent of any AI phrasing. */
  rationale: string;
}

/**
 * State of the asynchronous AI phrasing of a trend.
 *
 * `none` means no evaluation exists yet (too little history). `failed` exists because a
 * two-state pending/ready model cannot express a call that never came back, which is
 * exactly how a row ends up pending forever. `trend` is present whenever a row exists,
 * so the UI degrades to the deterministic numbers when prose is unavailable.
 */
export type EvaluationStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface BodyCompEvaluation {
  status: EvaluationStatus;
  measurementId?: string;
  trend?: TrendResult;
  /** AI-phrased summary. Absent unless status is 'ready'. */
  summary?: string;
  createdAt?: string;
  completedAt?: string;
  /** Present when status is 'failed', for display and support. */
  errorCode?: ApiErrorCode;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Everything the Overview tab renders, aggregated server-side into one response
 * (spec rule 5). OverviewDashboard imports no other feature's api.ts.
 */
export interface OverviewSummary {
  date: string;
  calories: {
    logged: number;
    target?: number;
    remaining?: number;
  };
  macros: {
    proteinG: number;
    carbsG: number;
    fatG: number;
    proteinTargetG?: number;
  };
  nextRoutine?: {
    id: string;
    name: string;
    exerciseCount: number;
  };
  lastWorkout?: {
    id: string;
    routineName: string;
    completedAt: string;
  };
  bodyComposition?: {
    latestWeightKg: number;
    latestDate: string;
    /** Change over the trend window; absent until there is enough history. */
    weightChangeKg?: number;
    ratePerWeekKg?: number;
    direction?: TrendDirection;
  };
  evaluation: {
    status: EvaluationStatus;
  };
  /** Count of writes still queued locally. The client fills this in; the server sends 0. */
  pendingSyncCount: number;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export type SubscriptionPlan = 'free' | 'premium';

/**
 * Always `{ plan: 'free', isPremium: false }` for now. The Premium upsell in Settings is
 * a non-functional placeholder and no payment gateway is wired up; the shape exists so a
 * real provider can drop in behind PaymentProvider without a client change.
 */
export interface SubscriptionStatus {
  plan: SubscriptionPlan;
  isPremium: boolean;
  /** Present once a real gateway is integrated. */
  renewsAt?: string;
}

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

export interface PushSubscription {
  id: string;
  /** OneSignal's per-device/browser identifier. */
  playerId: string;
  createdAt: string;
}

export interface PushSubscriptionInput {
  oneSignalPlayerId: string;
}

export type NotificationEvent = 'evaluation-ready' | 'log-reminder' | 'workout-reminder';

// ---------------------------------------------------------------------------
// Offline sync
// ---------------------------------------------------------------------------

/** The write kinds that can be queued offline. Food-database search cannot be. */
export type OfflineWriteKind = 'workout-log' | 'custom-food' | 'food-log' | 'body-measurement';

/**
 * One queued write in the client's IndexedDB outbox. `clientId` doubles as the
 * idempotency key the server dedupes on, so a retried flush never duplicates a row.
 */
export interface OfflineQueueItem {
  clientId: string;
  kind: OfflineWriteKind;
  /** Request body, already validated client-side. */
  payload: unknown;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}
