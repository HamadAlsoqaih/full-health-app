/**
 * TEMPORARY demo backend.
 *
 * Answers every /api request inside the browser, from sample data kept in
 * localStorage, so the deployed frontend works with no API behind it. Sign-in is
 * skipped entirely: the app boots already signed in as a fully onboarded demo
 * user. Plugged in through ApiProvider's `fetchImpl`, so no screen knows the
 * difference.
 *
 * Remove this folder and the VITE_DEMO_MODE switch in config.ts once the real
 * backend is deployed.
 */
import type {
  AuthResult,
  AuthSession,
  AuthUser,
  BodyCompEvaluation,
  BodyMeasurement,
  BodyMeasurementInput,
  ComputedTrend,
  CustomFood,
  CustomFoodInput,
  Exercise,
  FoodItem,
  FoodLogEntry,
  FoodLogInput,
  Goals,
  OverviewSummary,
  PhotoRefineResult,
  PhotoScanResult,
  Routine,
  RoutineInput,
  TrendResult,
  UserUpdateInput,
  WorkoutLog,
  WorkoutLogInput,
} from '@app/shared-types';
import type { SessionStore } from '@/shared/lib/apiClient';
import { toLocalDateIso } from '@/shared/lib/dates';

const STATE_KEY = 'fha.demo.v1';

export const DEMO_SESSION: AuthSession = {
  accessToken: 'demo-access-token',
  refreshToken: 'demo-refresh-token',
  expiresIn: 60 * 60 * 24 * 365,
  expiresAt: 4_000_000_000,
};

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const EXERCISES: Exercise[] = [
  {
    id: 'ex-bench',
    name: 'Barbell Bench Press',
    muscleGroup: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
    category: 'strength',
    level: 'intermediate',
    equipment: 'barbell',
    instructions: [
      'Lie on a flat bench with your eyes under the bar.',
      'Grip slightly wider than shoulder width and unrack.',
      'Lower to mid-chest, then press back up to lockout.',
    ],
  },
  {
    id: 'ex-incline-db',
    name: 'Incline Dumbbell Press',
    muscleGroup: 'chest',
    secondaryMuscles: ['shoulders', 'triceps'],
    category: 'strength',
    level: 'beginner',
    equipment: 'dumbbell',
    instructions: ['Set the bench to about 30°.', 'Press the dumbbells up and slightly in.'],
  },
  {
    id: 'ex-ohp',
    name: 'Overhead Press',
    muscleGroup: 'shoulders',
    secondaryMuscles: ['triceps'],
    category: 'strength',
    level: 'intermediate',
    equipment: 'barbell',
    instructions: ['Start with the bar at your collarbones.', 'Press straight overhead.'],
  },
  {
    id: 'ex-lateral',
    name: 'Dumbbell Lateral Raise',
    muscleGroup: 'shoulders',
    secondaryMuscles: [],
    category: 'strength',
    level: 'beginner',
    equipment: 'dumbbell',
    instructions: ['Raise the dumbbells out to the sides to shoulder height.'],
  },
  {
    id: 'ex-pushdown',
    name: 'Triceps Pushdown',
    muscleGroup: 'triceps',
    secondaryMuscles: [],
    category: 'strength',
    level: 'beginner',
    equipment: 'cable',
    instructions: ['Keep elbows pinned to your sides and extend fully.'],
  },
  {
    id: 'ex-deadlift',
    name: 'Deadlift',
    muscleGroup: 'lower back',
    secondaryMuscles: ['hamstrings', 'glutes', 'traps'],
    category: 'powerlifting',
    level: 'intermediate',
    equipment: 'barbell',
    instructions: ['Bar over mid-foot.', 'Brace, then stand up with a flat back.'],
  },
  {
    id: 'ex-pullup',
    name: 'Pull-Up',
    muscleGroup: 'lats',
    secondaryMuscles: ['biceps', 'middle back'],
    category: 'strength',
    level: 'intermediate',
    equipment: 'body only',
    instructions: ['Hang at arm’s length.', 'Pull until your chin clears the bar.'],
  },
  {
    id: 'ex-row',
    name: 'Bent-Over Barbell Row',
    muscleGroup: 'middle back',
    secondaryMuscles: ['lats', 'biceps'],
    category: 'strength',
    level: 'intermediate',
    equipment: 'barbell',
    instructions: ['Hinge to about 45°.', 'Row the bar to your lower ribs.'],
  },
  {
    id: 'ex-curl',
    name: 'Dumbbell Biceps Curl',
    muscleGroup: 'biceps',
    secondaryMuscles: ['forearms'],
    category: 'strength',
    level: 'beginner',
    equipment: 'dumbbell',
    instructions: ['Curl without swinging the torso.'],
  },
  {
    id: 'ex-squat',
    name: 'Barbell Back Squat',
    muscleGroup: 'quadriceps',
    secondaryMuscles: ['glutes', 'hamstrings'],
    category: 'strength',
    level: 'intermediate',
    equipment: 'barbell',
    instructions: ['Bar on upper back.', 'Squat to at least parallel and stand up.'],
  },
  {
    id: 'ex-rdl',
    name: 'Romanian Deadlift',
    muscleGroup: 'hamstrings',
    secondaryMuscles: ['glutes', 'lower back'],
    category: 'strength',
    level: 'beginner',
    equipment: 'barbell',
    instructions: ['Soft knees, push the hips back until you feel a hamstring stretch.'],
  },
  {
    id: 'ex-calf',
    name: 'Standing Calf Raise',
    muscleGroup: 'calves',
    secondaryMuscles: [],
    category: 'strength',
    level: 'beginner',
    equipment: 'machine',
    instructions: ['Rise onto your toes, pause, lower slowly.'],
  },
  {
    id: 'ex-plank',
    name: 'Plank',
    muscleGroup: 'abdominals',
    secondaryMuscles: [],
    category: 'strength',
    level: 'beginner',
    equipment: 'body only',
    instructions: ['Hold a straight line from head to heels.'],
  },
];

const FOODS: FoodItem[] = [
  food('usda:chicken-breast', 'Chicken breast, grilled', '100 g', 165, 31, 0, 3.6),
  food('usda:white-rice', 'White rice, cooked', '1 cup (158 g)', 205, 4.3, 45, 0.4),
  food('usda:brown-rice', 'Brown rice, cooked', '1 cup (195 g)', 216, 5, 45, 1.8),
  food('usda:egg', 'Egg, whole, large', '1 large (50 g)', 72, 6.3, 0.4, 4.8),
  food('usda:oats', 'Oats, rolled', '40 g', 150, 5, 27, 3),
  food('usda:banana', 'Banana', '1 medium (118 g)', 105, 1.3, 27, 0.4),
  food('usda:apple', 'Apple', '1 medium (182 g)', 95, 0.5, 25, 0.3),
  food('usda:salmon', 'Salmon, baked', '100 g', 206, 22, 0, 12),
  food('usda:beef-mince', 'Beef mince, 90% lean, cooked', '100 g', 217, 26, 0, 12),
  food('usda:broccoli', 'Broccoli, steamed', '1 cup (156 g)', 55, 3.7, 11, 0.6),
  food('usda:sweet-potato', 'Sweet potato, baked', '1 medium (114 g)', 103, 2.3, 24, 0.2),
  food('usda:olive-oil', 'Olive oil', '1 tbsp (14 g)', 119, 0, 0, 13.5),
  food('usda:almonds', 'Almonds', '28 g', 164, 6, 6, 14),
  food('usda:dates', 'Dates, medjool', '1 date (24 g)', 66, 0.4, 18, 0),
  food('usda:hummus', 'Hummus', '2 tbsp (30 g)', 70, 2, 4, 5),
  food('usda:pita', 'Pita bread, white', '1 large (60 g)', 165, 5.5, 33, 0.7),
  food('usda:lentils', 'Lentils, boiled', '1 cup (198 g)', 230, 18, 40, 0.8),
  food('off:greek-yogurt', 'Greek yogurt, plain 2%', '170 g', 146, 20, 8, 3.8, 'Almarai'),
  food('off:whey', 'Whey protein', '1 scoop (30 g)', 120, 24, 3, 1.5, 'Optimum Nutrition'),
  food('off:milk', 'Milk, full fat', '250 ml', 160, 8, 12, 9, 'Almarai'),
  food('off:labneh', 'Labneh', '2 tbsp (30 g)', 60, 2, 1, 5, 'Almarai'),
  food('off:kabsa', 'Chicken kabsa', '1 plate (350 g)', 620, 38, 70, 18),
];

function food(
  id: string,
  name: string,
  servingLabel: string,
  calories: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  brand?: string,
): FoodItem {
  return {
    id,
    name,
    source: id.startsWith('off:') ? 'open-food-facts' : 'usda',
    servingLabel,
    calories,
    proteinG,
    carbsG,
    fatG,
    ...(brand ? { brand } : {}),
  };
}

interface DemoState {
  user: AuthUser;
  routines: Routine[];
  workoutLogs: WorkoutLog[];
  measurements: BodyMeasurement[];
  foodLog: FoodLogEntry[];
  customFoods: CustomFood[];
  /** Photo estimates, so one can be logged after it is shown. */
  estimates: FoodItem[];
}

function daysAgo(n: number, hour = 12): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function makeLogEntry(
  item: FoodItem,
  date: string,
  multiplier: number,
  meal: FoodLogEntry['meal'],
) {
  const entry: FoodLogEntry = {
    id: uuid(),
    clientId: uuid(),
    date,
    foodItemId: item.id,
    foodName: item.name,
    source: item.source,
    servingLabel: item.servingLabel,
    servingMultiplier: multiplier,
    baseCalories: item.calories,
    baseProteinG: item.proteinG,
    baseCarbsG: item.carbsG,
    baseFatG: item.fatG,
    calories: round(item.calories * multiplier),
    proteinG: round(item.proteinG * multiplier),
    carbsG: round(item.carbsG * multiplier),
    fatG: round(item.fatG * multiplier),
    loggedAt: new Date().toISOString(),
  };
  if (meal) entry.meal = meal;
  return entry;
}

function seed(): DemoState {
  const now = new Date().toISOString();
  const user: AuthUser = {
    id: 'demo-user',
    email: 'demo@fullhealth.app',
    displayName: 'Demo',
    units: 'metric',
    goals: {
      goal: 'cut',
      targetCalories: 2200,
      targetProteinG: 170,
      targetRateKgPerWeek: -0.5,
      dietaryPrefs: { preferences: ['halal'], skipped: false },
    },
    preferences: {
      notifications: { remindersEnabled: true, evaluationReadyEnabled: true },
      ai: { enabled: true, photoScanEnabled: true, evaluationEnabled: true },
    },
    onboarding: { goalsSubmitted: true, startingStatsSubmitted: true, complete: true },
    createdAt: daysAgo(35).toISOString(),
  };

  const ex = (id: string) => EXERCISES.find((e) => e.id === id)!;
  const planned = (id: string, sets: number, targetReps: number, targetWeightKg?: number) => ({
    exerciseId: id,
    exerciseName: ex(id).name,
    sets,
    targetReps,
    restSeconds: 90,
    ...(targetWeightKg !== undefined ? { targetWeightKg } : {}),
  });

  const routines: Routine[] = [
    {
      id: 'routine-push',
      name: 'Push Day',
      exercises: [
        planned('ex-bench', 4, 8, 80),
        planned('ex-ohp', 3, 8, 45),
        planned('ex-incline-db', 3, 10, 26),
        planned('ex-lateral', 3, 15, 10),
        planned('ex-pushdown', 3, 12, 30),
      ],
      createdAt: daysAgo(30).toISOString(),
      updatedAt: daysAgo(30).toISOString(),
    },
    {
      id: 'routine-pull',
      name: 'Pull Day',
      exercises: [
        planned('ex-deadlift', 3, 5, 140),
        planned('ex-pullup', 4, 8),
        planned('ex-row', 3, 10, 70),
        planned('ex-curl', 3, 12, 14),
      ],
      createdAt: daysAgo(30).toISOString(),
      updatedAt: daysAgo(30).toISOString(),
    },
    {
      id: 'routine-legs',
      name: 'Leg Day',
      exercises: [
        planned('ex-squat', 4, 6, 110),
        planned('ex-rdl', 3, 10, 90),
        planned('ex-calf', 4, 15, 60),
        planned('ex-plank', 3, 1),
      ],
      createdAt: daysAgo(30).toISOString(),
      updatedAt: daysAgo(30).toISOString(),
    },
  ];

  // Push / pull / legs, every other day for the last four weeks.
  const workoutLogs: WorkoutLog[] = [];
  for (let i = 0, day = 27; day >= 1; i++, day -= 2) {
    const routine = routines[i % routines.length]!;
    const completed = daysAgo(day, 19).toISOString();
    const progress = Math.floor(i / 3) * 2.5;
    workoutLogs.push({
      id: uuid(),
      clientId: uuid(),
      routineId: routine.id,
      routineName: routine.name,
      completedAt: completed,
      durationSeconds: 3000 + (i % 4) * 300,
      performed: routine.exercises.map((p) => ({
        exerciseId: p.exerciseId,
        exerciseName: p.exerciseName,
        sets: Array.from({ length: p.sets }, () => ({
          reps: p.targetReps,
          ...(p.targetWeightKg !== undefined ? { weightKg: p.targetWeightKg + progress } : {}),
        })),
      })),
      createdAt: completed,
    });
  }
  workoutLogs.reverse();

  // Weigh-ins every few days: 86.0 kg trending down about 0.45 kg/week.
  const measurements: BodyMeasurement[] = [];
  for (let day = 30; day >= 0; day -= 3) {
    const date = toLocalDateIso(daysAgo(day));
    const wobble = [0.2, -0.1, 0.3, 0, -0.2][day % 5]!;
    measurements.push({
      id: uuid(),
      clientId: uuid(),
      date,
      weightKg: round(86 - ((30 - day) / 7) * 0.45 + wobble),
      bodyFatPct: round(21 - ((30 - day) / 30) * 1.2),
      ...(day % 9 === 0 ? { tapeCm: { waist: round(92 - (30 - day) * 0.06), neck: 39 } } : {}),
      createdAt: daysAgo(day, 8).toISOString(),
    });
  }

  // A full day of eating for each of the last 14 days, plus today so far.
  const byId = (id: string) => FOODS.find((f) => f.id === id)!;
  const foodLog: FoodLogEntry[] = [];
  for (let day = 14; day >= 1; day--) {
    const date = toLocalDateIso(daysAgo(day));
    foodLog.push(
      makeLogEntry(byId('usda:oats'), date, 1.5, 'breakfast'),
      makeLogEntry(byId('off:whey'), date, 1, 'breakfast'),
      makeLogEntry(byId('usda:banana'), date, 1, 'breakfast'),
      makeLogEntry(byId('usda:chicken-breast'), date, 2, 'lunch'),
      makeLogEntry(byId('usda:white-rice'), date, 1.5, 'lunch'),
      makeLogEntry(byId('usda:broccoli'), date, 1, 'lunch'),
      makeLogEntry(byId(day % 2 ? 'usda:salmon' : 'usda:beef-mince'), date, 2, 'dinner'),
      makeLogEntry(byId('usda:sweet-potato'), date, 1, 'dinner'),
      makeLogEntry(byId('off:greek-yogurt'), date, 1, 'snack'),
      makeLogEntry(byId('usda:dates'), date, 2, 'snack'),
    );
  }
  const today = toLocalDateIso(new Date());
  foodLog.push(
    makeLogEntry(byId('usda:egg'), today, 3, 'breakfast'),
    makeLogEntry(byId('usda:pita'), today, 1, 'breakfast'),
    makeLogEntry(byId('off:labneh'), today, 1, 'breakfast'),
    makeLogEntry(byId('off:kabsa'), today, 1, 'lunch'),
  );

  const customFoods: CustomFood[] = [
    {
      id: 'custom:mums-harees',
      clientId: uuid(),
      name: 'Mum’s harees',
      servingLabel: '1 bowl',
      calories: 410,
      proteinG: 28,
      carbsG: 52,
      fatG: 10,
      createdAt: now,
    },
  ];

  return { user, routines, workoutLogs, measurements, foodLog, customFoods, estimates: [] };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let memoryState: DemoState | null = null;

function load(): DemoState {
  if (memoryState) return memoryState;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      memoryState = JSON.parse(raw) as DemoState;
      return memoryState;
    }
  } catch {
    // Fall through to a fresh seed.
  }
  memoryState = seed();
  save();
  return memoryState;
}

function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(memoryState));
  } catch {
    // Blocked storage: the demo still works for this tab.
  }
}

/**
 * Always signed in, so the app never shows signup or login.
 *
 * Signing out resets the sample data instead of leaving the session: there is
 * no account to leave, and landing back on the signup form is what this exists
 * to avoid.
 */
export const demoSessionStore: SessionStore = {
  get: () => DEMO_SESSION,
  set(session) {
    if (session === null) resetDemoData();
  },
  subscribe: () => () => {},
};

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

function round(n: number, places = 1) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function computeTrend(state: DemoState, days: number): TrendResult {
  const from = toLocalDateIso(daysAgo(days));
  const points = state.measurements
    .filter((m) => m.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date));
  const loggedDays = new Set(state.foodLog.filter((e) => e.date >= from).map((e) => e.date));

  const span =
    points.length > 1
      ? (Date.parse(points.at(-1)!.date) - Date.parse(points[0]!.date)) / 86_400_000
      : 0;

  if (points.length < 3 || span < 7 || loggedDays.size < 5) {
    const reasons: Array<'not-enough-weight-entries' | 'span-too-short' | 'not-enough-food-logs'> =
      [];
    if (points.length < 3) reasons.push('not-enough-weight-entries');
    if (span < 7) reasons.push('span-too-short');
    if (loggedDays.size < 5) reasons.push('not-enough-food-logs');
    return {
      status: 'insufficient-data',
      reasons,
      daysNeeded: Math.max(0, Math.ceil(7 - span)),
      weightEntryCount: points.length,
      daysWithFoodLogs: loggedDays.size,
    };
  }

  // Least-squares slope, kg per day.
  const t0 = Date.parse(points[0]!.date);
  const xs = points.map((p) => (Date.parse(p.date) - t0) / 86_400_000);
  const ys = points.map((p) => p.weightKg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1;
  const slopePerDay = num / den;
  const ratePerWeekKg = round(slopePerDay * 7, 2);

  const dayTotals = new Map<string, { cal: number; protein: number }>();
  for (const e of state.foodLog) {
    if (e.date < from) continue;
    const t = dayTotals.get(e.date) ?? { cal: 0, protein: 0 };
    t.cal += e.calories;
    t.protein += e.proteinG;
    dayTotals.set(e.date, t);
  }
  const totals = [...dayTotals.values()];
  const avgDailyCalories = Math.round(totals.reduce((s, t) => s + t.cal, 0) / totals.length);
  const avgDailyProteinG = Math.round(totals.reduce((s, t) => s + t.protein, 0) / totals.length);
  const estimatedMaintenanceCalories = Math.round(avgDailyCalories - slopePerDay * 7700);

  const direction = ratePerWeekKg < -0.1 ? 'losing' : ratePerWeekKg > 0.1 ? 'gaining' : 'holding';
  const target = state.user.goals?.targetRateKgPerWeek ?? -0.5;
  const gap = target - ratePerWeekKg;
  const delta = Math.abs(gap) < 0.15 ? 0 : Math.round((gap * 7700) / 7 / 50) * 50;

  const trend: ComputedTrend = {
    status: 'ok',
    fromDate: points[0]!.date,
    toDate: points.at(-1)!.date,
    days: Math.round(span),
    startWeightKg: points[0]!.weightKg,
    endWeightKg: points.at(-1)!.weightKg,
    weightChangeKg: round(points.at(-1)!.weightKg - points[0]!.weightKg),
    ratePerWeekKg,
    direction,
    avgDailyCalories,
    avgDailyProteinG,
    daysWithFoodLogs: loggedDays.size,
    estimatedMaintenanceCalories,
    recommendation: {
      action: delta === 0 ? 'hold-calories' : delta < 0 ? 'reduce-calories' : 'increase-calories',
      secondaryActions: avgDailyProteinG < 160 ? ['increase-protein'] : [],
      calorieDeltaPerDay: delta,
      proteinTargetG: state.user.goals?.targetProteinG ?? 170,
      rationale:
        delta === 0
          ? `You are losing ${Math.abs(ratePerWeekKg)} kg/week, close to your ${Math.abs(target)} kg/week target. Keep intake where it is.`
          : `Your rate of ${ratePerWeekKg} kg/week is off your ${target} kg/week target; adjust intake by ${delta} kcal/day.`,
    },
  };
  return trend;
}

function evaluation(state: DemoState): BodyCompEvaluation {
  const trend = computeTrend(state, 30);
  if (trend.status !== 'ok') return { status: 'none', trend };
  const latest = state.measurements.at(-1);
  return {
    status: 'ready',
    ...(latest ? { measurementId: latest.id } : {}),
    trend,
    summary:
      `Over the last ${trend.days} days you went from ${trend.startWeightKg} kg to ${trend.endWeightKg} kg, ` +
      `about ${Math.abs(trend.ratePerWeekKg)} kg per week. With an average of ${trend.avgDailyCalories} kcal a day, ` +
      `your maintenance looks to be around ${trend.estimatedMaintenanceCalories} kcal. ${trend.recommendation.rationale}`,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

function overview(state: DemoState, date: string): OverviewSummary {
  const entries = state.foodLog.filter((e) => e.date === date);
  const sum = (k: 'calories' | 'proteinG' | 'carbsG' | 'fatG') =>
    round(entries.reduce((s, e) => s + e[k], 0));
  const logged = Math.round(sum('calories'));
  const target = state.user.goals?.targetCalories;
  const last = [...state.workoutLogs].sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
  const lastIdx = last ? state.routines.findIndex((r) => r.id === last.routineId) : -1;
  const next = state.routines[(lastIdx + 1) % Math.max(1, state.routines.length)];
  const latest = [...state.measurements].sort((a, b) => b.date.localeCompare(a.date))[0];
  const trend = computeTrend(state, 30);

  const summary: OverviewSummary = {
    date,
    calories: {
      logged,
      ...(target !== undefined ? { target, remaining: target - logged } : {}),
    },
    macros: {
      proteinG: sum('proteinG'),
      carbsG: sum('carbsG'),
      fatG: sum('fatG'),
      ...(state.user.goals?.targetProteinG !== undefined
        ? { proteinTargetG: state.user.goals.targetProteinG }
        : {}),
    },
    evaluation: { status: evaluation(state).status },
    pendingSyncCount: 0,
  };
  if (next)
    summary.nextRoutine = { id: next.id, name: next.name, exerciseCount: next.exercises.length };
  if (last)
    summary.lastWorkout = {
      id: last.id,
      routineName: last.routineName,
      completedAt: last.completedAt,
    };
  if (latest) {
    summary.bodyComposition = {
      latestWeightKg: latest.weightKg,
      latestDate: latest.date,
      ...(trend.status === 'ok'
        ? {
            weightChangeKg: trend.weightChangeKg,
            ratePerWeekKg: trend.ratePerWeekKg,
            direction: trend.direction,
          }
        : {}),
    };
  }
  return summary;
}

function resolveFood(state: DemoState, id: string): FoodItem | undefined {
  const custom = state.customFoods.find((c) => c.id === id);
  if (custom) return { ...custom, source: 'custom' };
  return FOODS.find((f) => f.id === id) ?? state.estimates.find((f) => f.id === id);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function photoEstimate(state: DemoState, calories: number): FoodItem {
  const item: FoodItem = {
    id: `estimate:${uuid()}`,
    name: 'Grilled chicken with rice and salad',
    source: 'ai-photo-estimate',
    servingLabel: '1 plate',
    calories,
    proteinG: Math.round(calories * 0.075),
    carbsG: Math.round(calories * 0.11),
    fatG: Math.round(calories * 0.03),
  };
  state.estimates.push(item);
  return item;
}

function handle(method: string, url: URL, body: unknown, init?: RequestInit): unknown {
  const state = load();
  const path = url.pathname.replace(/\/$/, '');
  const q = url.searchParams;
  const now = new Date().toISOString();

  // ---- Auth: any credentials work and land in the demo account ---------
  if (path === '/api/auth/login' || path === '/api/auth/register') {
    return { user: state.user, session: DEMO_SESSION } satisfies AuthResult;
  }
  if (path === '/api/auth/refresh') return { session: DEMO_SESSION };
  if (path === '/api/auth/logout') return undefined;

  // ---- User --------------------------------------------------------------
  if (path === '/api/users/me' && method === 'GET') return state.user;
  if (path === '/api/users/me' && method === 'PUT') {
    const patch = body as UserUpdateInput;
    state.user = {
      ...state.user,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.units ? { units: patch.units } : {}),
      ...(patch.goals ? { goals: patch.goals } : {}),
      preferences: {
        notifications: {
          ...state.user.preferences.notifications,
          ...patch.preferences?.notifications,
        },
        ai: { ...state.user.preferences.ai, ...patch.preferences?.ai },
      },
    };
    save();
    return state.user;
  }
  if (path === '/api/users/me/onboarding') {
    state.user.goals = (body as { goals: Goals }).goals;
    save();
    return state.user;
  }

  // ---- Training ----------------------------------------------------------
  if (path === '/api/exercises') {
    const group = q.get('muscleGroup');
    const term = q.get('q')?.toLowerCase();
    return EXERCISES.filter(
      (e) => (!group || e.muscleGroup === group) && (!term || e.name.toLowerCase().includes(term)),
    );
  }
  if (path === '/api/routines' && method === 'GET') return state.routines;
  if (path === '/api/routines' && method === 'POST') {
    const input = body as RoutineInput;
    const routine: Routine = { id: uuid(), ...input, createdAt: now, updatedAt: now };
    state.routines.push(routine);
    save();
    return routine;
  }
  const routineMatch = path.match(/^\/api\/routines\/([^/]+)$/);
  if (routineMatch) {
    const id = decodeURIComponent(routineMatch[1]!);
    const idx = state.routines.findIndex((r) => r.id === id);
    if (idx < 0) throw new HttpError(404, 'NOT_FOUND', 'Routine not found.');
    if (method === 'DELETE') {
      state.routines.splice(idx, 1);
      for (const log of state.workoutLogs) if (log.routineId === id) log.routineId = null;
      save();
      return undefined;
    }
    if (method === 'PUT') {
      state.routines[idx] = {
        ...state.routines[idx]!,
        ...(body as Partial<RoutineInput>),
        updatedAt: now,
      };
      save();
      return state.routines[idx];
    }
  }
  if (path === '/api/workout-logs' && method === 'GET') {
    return [...state.workoutLogs].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  }
  if (path === '/api/workout-logs' && method === 'POST') {
    const input = body as WorkoutLogInput;
    const existing = state.workoutLogs.find((l) => l.clientId === input.clientId);
    if (existing) return existing;
    const log: WorkoutLog = { id: uuid(), ...input, createdAt: now };
    state.workoutLogs.push(log);
    save();
    return log;
  }

  // ---- Nutrition ---------------------------------------------------------
  if (path === '/api/nutrition/search') {
    const term = (q.get('q') ?? '').toLowerCase().trim();
    const words = term.split(/\s+/).filter(Boolean);
    const matches = (name: string) => words.every((w) => name.toLowerCase().includes(w));
    const items: FoodItem[] = [
      ...state.customFoods
        .filter((c) => matches(c.name))
        .map((c): FoodItem => ({ ...c, source: 'custom' })),
      ...FOODS.filter((f) => matches(`${f.name} ${f.brand ?? ''}`)),
    ];
    return { query: q.get('q') ?? '', items, fromCache: false, unavailableSources: [] };
  }
  if (path === '/api/nutrition/custom-foods' && method === 'GET') return state.customFoods;
  if (path === '/api/nutrition/custom-foods' && method === 'POST') {
    const input = body as CustomFoodInput;
    const existing = state.customFoods.find((c) => c.clientId === input.clientId);
    if (existing) return existing;
    const created: CustomFood = {
      ...input,
      id: `custom:${uuid()}`,
      servingLabel: input.servingLabel ?? '1 serving',
      createdAt: now,
    };
    state.customFoods.push(created);
    save();
    return created;
  }
  if (path === '/api/nutrition/log' && method === 'GET') {
    const date = q.get('date') ?? toLocalDateIso(new Date());
    return state.foodLog.filter((e) => e.date === date);
  }
  if (path === '/api/nutrition/log' && method === 'POST') {
    const input = body as FoodLogInput;
    const existing = state.foodLog.find((e) => e.clientId === input.clientId);
    if (existing) return existing;
    const item = resolveFood(state, input.foodItemId);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'That food could not be found.');
    const entry = {
      ...makeLogEntry(item, input.date, input.servingMultiplier, input.meal),
      clientId: input.clientId,
    };
    state.foodLog.push(entry);
    save();
    return entry;
  }
  const logMatch = path.match(/^\/api\/nutrition\/log\/([^/]+)$/);
  if (logMatch && method === 'DELETE') {
    const id = decodeURIComponent(logMatch[1]!);
    state.foodLog = state.foodLog.filter((e) => e.id !== id);
    save();
    return undefined;
  }
  if (path === '/api/nutrition/scan-photo') {
    const estimate = photoEstimate(state, 620);
    save();
    return {
      estimate,
      confidence: 'medium',
      detectedItems: ['grilled chicken', 'white rice', 'green salad'],
      questions: [
        {
          id: 'oil',
          question: 'Was oil or dressing added?',
          options: ['None', 'A little', 'A lot', 'Not sure'],
        },
        {
          id: 'rice',
          question: 'How much rice is on the plate?',
          options: ['Less than a cup', 'About a cup', 'Two cups or more', 'Not sure'],
        },
      ],
      autoLogged: false,
    } satisfies PhotoScanResult;
  }
  if (path === '/api/nutrition/scan-photo/refine') {
    let previousCalories = 620;
    let bump = 0;
    const raw = init?.body instanceof FormData ? init.body.get('answers') : null;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as {
          previousEstimateId: string;
          answers: Array<{ option: string | null }>;
        };
        previousCalories =
          state.estimates.find((e) => e.id === parsed.previousEstimateId)?.calories ?? 620;
        for (const a of parsed.answers) {
          if (a.option === 'A little') bump += 60;
          if (a.option === 'A lot') bump += 180;
          if (a.option === 'Two cups or more') bump += 200;
          if (a.option === 'Less than a cup') bump -= 100;
        }
      } catch {
        // Keep the defaults.
      }
    }
    const estimate = photoEstimate(state, previousCalories + bump);
    save();
    return {
      estimate,
      confidence: 'medium',
      detectedItems: ['grilled chicken', 'white rice', 'green salad'],
      previousCalories,
      autoLogged: false,
    } satisfies PhotoRefineResult;
  }

  // ---- Body composition --------------------------------------------------
  if (path === '/api/body-composition' && method === 'GET') {
    return [...state.measurements].sort((a, b) => b.date.localeCompare(a.date));
  }
  if (path === '/api/body-composition/entry') {
    const input = body as BodyMeasurementInput;
    const existing = state.measurements.find((m) => m.clientId === input.clientId);
    if (existing) return existing;
    const created: BodyMeasurement = { id: uuid(), ...input, createdAt: now };
    state.measurements.push(created);
    state.measurements.sort((a, b) => a.date.localeCompare(b.date));
    save();
    return created;
  }
  if (path === '/api/body-composition/trend') {
    return computeTrend(state, Number(q.get('days') ?? 30) || 30);
  }
  if (path === '/api/body-composition/evaluation') return evaluation(state);

  // ---- Overview, billing, notifications ----------------------------------
  if (path === '/api/overview') return overview(state, q.get('date') ?? toLocalDateIso(new Date()));
  if (path === '/api/billing/status') return { plan: 'free', isPremium: false };
  if (path === '/api/billing/premium-teaser') {
    return {
      title: 'Full Health Premium',
      subtitle: 'Coming soon',
      features: ['Unlimited photo scans', 'Weekly coach check-ins', 'Advanced trend analysis'],
    };
  }
  if (path === '/api/notifications/subscribe') return undefined;
  if (path === '/api/health') return { status: 'ok', demo: true };

  throw new HttpError(404, 'NOT_FOUND', `Demo mode has no handler for ${method} ${path}.`);
}

/** A fetch-compatible function that answers from the demo state. */
export const demoFetch: typeof globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    window.location.origin,
  );
  const method = (init?.method ?? 'GET').toUpperCase();
  const json = (status: number, data: unknown) =>
    new Response(data === undefined ? null : JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  // A short delay so loading states behave as they would against a network.
  await new Promise((resolve) =>
    setTimeout(resolve, url.pathname.includes('scan-photo') ? 1200 : 120),
  );

  try {
    const data = handle(method, url, await readJson(init), init);
    return data === undefined ? new Response(null, { status: 204 }) : json(200, data);
  } catch (error) {
    if (error instanceof HttpError) {
      return json(error.status, { error: { code: error.code, message: error.message } });
    }
    return json(500, {
      error: { code: 'INTERNAL', message: error instanceof Error ? error.message : 'Demo error' },
    });
  }
};

/** Throws away every change and restores the sample data. */
export function resetDemoData() {
  memoryState = seed();
  save();
}
