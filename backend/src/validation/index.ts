/**
 * Request schemas, one per endpoint.
 *
 * Everything is `.strict()`. An unexpected field is rejected rather than silently
 * dropped, which is what stops a client sending a server-owned field to an endpoint
 * that never meant to accept it — the PUT /users/me mass-assignment hole in
 * particular.
 *
 * Numeric bounds mirror the CHECK constraints in the migration. Duplicating them
 * is deliberate: the database is the backstop, but a 400 naming the offending field
 * is a far better answer to the client than a 500 from a constraint violation.
 */
import { z } from 'zod';

/**
 * A client-minted idempotency key. Bounds match the CHECK constraint on every
 * offline-syncable table.
 */
export const clientIdSchema = z
  .string()
  .min(8, 'clientId must be at least 8 characters')
  .max(128)
  .regex(/^[A-Za-z0-9_:-]+$/, 'clientId may only contain letters, digits, _, : and -');

/** A plain calendar day. Not a timestamp: this is the user's local day. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Not a real date');

export const isoDateTimeSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a valid timestamp');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const credentialsSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    // 8 is the floor, not a recommendation. Upper bound guards against a
    // megabyte-long string being fed to the password hasher.
    password: z.string().min(8, 'Use at least 8 characters').max(256),
  })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(10) }).strict();

// ---------------------------------------------------------------------------
// Users, goals and onboarding
// ---------------------------------------------------------------------------

export const dietaryPreferencesSchema = z
  .object({
    preferences: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    allergies: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    skipped: z.boolean().default(false),
  })
  .strict();

export const goalsSchema = z
  .object({
    goal: z.enum(['cut', 'bulk', 'maintain']),
    targetCalories: z.number().int().min(800).max(10_000).optional(),
    targetProteinG: z.number().min(0).max(500).optional(),
    // Signed: negative for a cut. Bounded to a rate that is not actively unsafe.
    targetRateKgPerWeek: z.number().min(-2).max(2).optional(),
    dietaryPrefs: dietaryPreferencesSchema.optional(),
  })
  .strict();

export const onboardingSchema = z.object({ goals: goalsSchema }).strict();

const notificationPreferencesSchema = z
  .object({
    remindersEnabled: z.boolean().optional(),
    evaluationReadyEnabled: z.boolean().optional(),
  })
  .strict();

const aiPreferencesSchema = z
  .object({
    enabled: z.boolean().optional(),
    photoScanEnabled: z.boolean().optional(),
    evaluationEnabled: z.boolean().optional(),
  })
  .strict();

/**
 * The writable subset of the user record. Note what is absent: id, email and
 * onboarding. Those are server-owned, and `.strict()` turns an attempt to set them
 * into a 400 rather than a silent no-op.
 */
export const userUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    units: z.enum(['metric', 'imperial']).optional(),
    goals: goalsSchema.optional(),
    preferences: z
      .object({
        notifications: notificationPreferencesSchema.optional(),
        ai: aiPreferencesSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export const exerciseQuerySchema = z
  .object({
    muscleGroup: z.string().trim().min(1).max(40).optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const routineExerciseSchema = z
  .object({
    exerciseId: z.string().uuid(),
    exerciseName: z.string().trim().min(1).max(160),
    sets: z.number().int().min(1).max(20),
    targetReps: z.number().int().min(1).max(200),
    targetWeightKg: z.number().min(0).max(1000).optional(),
    restSeconds: z.number().int().min(0).max(1800).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const routineInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the routine a name').max(120),
    exercises: z.array(routineExerciseSchema).min(1, 'Add at least one exercise').max(60),
  })
  .strict();

export const routineUpdateSchema = routineInputSchema.partial().strict();

const performedSetSchema = z
  .object({
    reps: z.number().int().min(0).max(500),
    weightKg: z.number().min(0).max(1000).optional(),
    skipped: z.boolean().optional(),
  })
  .strict();

const performedExerciseSchema = z
  .object({
    exerciseId: z.string().uuid(),
    exerciseName: z.string().trim().min(1).max(160),
    sets: z.array(performedSetSchema).max(50),
  })
  .strict();

export const workoutLogInputSchema = z
  .object({
    clientId: clientIdSchema,
    // Nullable, not optional: a log may outlive the routine it came from.
    routineId: z.string().uuid().nullable(),
    routineName: z.string().trim().min(1).max(120),
    completedAt: isoDateTimeSchema,
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
    performed: z.array(performedExerciseSchema).max(60).default([]),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export const nutritionSearchQuerySchema = z
  .object({ q: z.string().trim().min(2, 'Enter at least two characters').max(80) })
  .strict();

export const customFoodInputSchema = z
  .object({
    clientId: clientIdSchema,
    name: z.string().trim().min(1, 'Give the food a name').max(200),
    brand: z.string().trim().max(120).optional(),
    servingLabel: z.string().trim().min(1).max(60).optional(),
    calories: z.number().min(0).max(10_000),
    proteinG: z.number().min(0).max(1000).default(0),
    carbsG: z.number().min(0).max(1000).default(0),
    fatG: z.number().min(0).max(1000).default(0),
    fiberG: z.number().min(0).max(1000).optional(),
  })
  .strict();

/**
 * `foodItemId` is namespaced by source so a single server-side resolution path
 * serves USDA, Open Food Facts, custom foods, AI estimates and manual entries.
 * The server resolves the macros; the client never supplies them here.
 */
export const foodLogInputSchema = z
  .object({
    clientId: clientIdSchema,
    foodItemId: z
      .string()
      .min(1)
      .max(200)
      .regex(
        /^(usda|off|custom|estimate|manual):[A-Za-z0-9_.:-]*$/,
        'foodItemId must be namespaced, e.g. usda:12345',
      ),
    date: isoDateSchema,
    servingMultiplier: z.number().gt(0, 'Serving must be greater than zero').max(100),
    meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  })
  .strict();

export const foodLogQuerySchema = z.object({ date: isoDateSchema }).strict();

// ---------------------------------------------------------------------------
// Body composition
// ---------------------------------------------------------------------------

const tapeSchema = z
  .object({
    neck: z.number().min(0).max(300).optional(),
    chest: z.number().min(0).max(300).optional(),
    waist: z.number().min(0).max(300).optional(),
    hips: z.number().min(0).max(300).optional(),
    thigh: z.number().min(0).max(300).optional(),
    arm: z.number().min(0).max(300).optional(),
    calf: z.number().min(0).max(300).optional(),
  })
  .strict();

export const bodyMeasurementInputSchema = z
  .object({
    clientId: clientIdSchema,
    date: isoDateSchema,
    // Bounds match the migration's CHECK. Metric only — conversion happens in the UI.
    weightKg: z.number().gt(0, 'Enter a weight').lt(700),
    bodyFatPct: z.number().min(0).max(75).optional(),
    tapeCm: tapeSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const trendQuerySchema = z
  .object({ days: z.coerce.number().int().min(7).max(365).default(30) })
  .strict();

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const pushSubscriptionSchema = z
  .object({ oneSignalPlayerId: z.string().trim().min(8).max(200) })
  .strict();

// ---------------------------------------------------------------------------
// Shared params
// ---------------------------------------------------------------------------

export const idParamSchema = z.object({ id: z.string().uuid('Not a valid id') }).strict();
