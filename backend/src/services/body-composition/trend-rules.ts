/**
 * Body-composition trend arithmetic.
 *
 * This is deterministic, pure, and never AI (spec rule 4). The AI layer only
 * rephrases the result of this module; it does not produce or adjust any number
 * here. That separation is the reason a user with AI disabled still gets the full
 * analysis.
 *
 * The energy conversion used throughout is the standard ~7700 kcal per kilogram of
 * body mass (the metric form of the familiar 3500 kcal per pound). It is a
 * population approximation, not a physical constant — which is precisely why the
 * output is framed as a nudge in a direction rather than a precise prescription.
 */
import type {
  BodyMeasurement,
  ComputedTrend,
  FoodLogEntry,
  Goals,
  InsufficientTrendData,
  TrendAction,
  TrendRecommendation,
  TrendResult,
} from '@app/shared-types';

/** kcal per kg of body mass. */
const KCAL_PER_KG = 7700;

/**
 * Minimum evidence before any trend is reported.
 *
 * Below these, weight noise (hydration, food in transit, time of day) swamps the
 * signal and the arithmetic would produce confident nonsense. Refusing to answer is
 * the correct output, so the UI can say what is still needed.
 */
export const THRESHOLDS = {
  minSpanDays: 14,
  minWeightEntries: 2,
  minDaysWithFoodLogs: 7,
} as const;

/** Rate within this of target counts as on-track, not as drift to correct. */
const RATE_TOLERANCE_KG_PER_WEEK = 0.15;

/** Protein floor, g per kg of body mass. */
const PROTEIN_FLOOR_G_PER_KG = 1.6;

/** Largest daily calorie change this will ever suggest. */
const MAX_CALORIE_DELTA = 500;

/** Default weekly rate per goal, when the user set no explicit target. */
const DEFAULT_TARGET_RATE: Record<Goals['goal'], number> = {
  cut: -0.5,
  bulk: 0.25,
  maintain: 0,
};

export interface TrendInput {
  measurements: BodyMeasurement[];
  foodLog: FoodLogEntry[];
  goals?: Goals;
  /** Present so callers can be tested without touching real time. */
  now: Date;
  /** Analysis window. */
  windowDays: number;
}

const toDayNumber = (isoDate: string): number =>
  Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);

const round = (value: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
};

/**
 * Collapses several entries on one day to the last one recorded.
 *
 * The schema deliberately permits multiple measurements per day — a unique
 * constraint per day would conflict with the offline idempotency key — so the
 * ambiguity is resolved here instead. "Last recorded" means latest createdAt, not
 * highest or lowest weight, so the user's most recent correction wins.
 */
export function latestPerDay(measurements: BodyMeasurement[]): BodyMeasurement[] {
  const byDay = new Map<string, BodyMeasurement>();
  for (const m of measurements) {
    const existing = byDay.get(m.date);
    if (!existing || m.createdAt >= existing.createdAt) byDay.set(m.date, m);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Least-squares slope of weight against time, in kg per week.
 *
 * A regression rather than (last - first) / days, because endpoint-to-endpoint
 * differencing is dominated by whatever noise happens to sit on those two days.
 */
export function weeklyRate(points: BodyMeasurement[]): number {
  if (points.length < 2) return 0;

  const xs = points.map((p) => toDayNumber(p.date));
  const ys = points.map((p) => p.weightKg);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - meanX;
    numerator += dx * ((ys[i] as number) - meanY);
    denominator += dx * dx;
  }

  // All entries on the same day: no time span, so no rate.
  if (denominator === 0) return 0;

  return (numerator / denominator) * 7;
}

function chooseActions(
  ratePerWeekKg: number,
  targetRate: number,
  avgProteinPerKg: number,
  daysWithFoodLogs: number,
  windowDays: number,
): { action: TrendAction; secondary: TrendAction[] } {
  const secondary: TrendAction[] = [];

  if (avgProteinPerKg < PROTEIN_FLOOR_G_PER_KG) secondary.push('increase-protein');

  // Sparse logging makes the intake figure unreliable even when it passes the
  // minimum, so it is worth saying so alongside the main advice.
  if (daysWithFoodLogs < windowDays * 0.6) secondary.push('log-more-consistently');

  const drift = ratePerWeekKg - targetRate;

  if (Math.abs(drift) <= RATE_TOLERANCE_KG_PER_WEEK) {
    // On track. If protein is the only thing wrong, lead with that.
    if (secondary[0] === 'increase-protein') {
      return { action: 'increase-protein', secondary: secondary.slice(1) };
    }
    return { action: 'hold-calories', secondary };
  }

  // Drifting upward relative to target → eat less; downward → eat more.
  return { action: drift > 0 ? 'reduce-calories' : 'increase-calories', secondary };
}

function buildRecommendation(
  ratePerWeekKg: number,
  goals: Goals | undefined,
  avgDailyCalories: number,
  avgDailyProteinG: number,
  currentWeightKg: number,
  daysWithFoodLogs: number,
  windowDays: number,
): TrendRecommendation {
  const goal = goals?.goal ?? 'maintain';
  const targetRate = goals?.targetRateKgPerWeek ?? DEFAULT_TARGET_RATE[goal];
  const avgProteinPerKg = currentWeightKg > 0 ? avgDailyProteinG / currentWeightKg : 0;

  const { action, secondary } = chooseActions(
    ratePerWeekKg,
    targetRate,
    avgProteinPerKg,
    daysWithFoodLogs,
    windowDays,
  );

  // Shifting the weekly rate by ΔR kg/week needs ΔR × 7700 / 7 kcal per day.
  const rawDelta = ((targetRate - ratePerWeekKg) * KCAL_PER_KG) / 7;
  const clamped = Math.max(-MAX_CALORIE_DELTA, Math.min(MAX_CALORIE_DELTA, rawDelta));
  // Rounded to 25 kcal: presenting 137 would imply precision this does not have.
  const calorieDeltaPerDay =
    action === 'hold-calories' || action === 'increase-protein' ? 0 : Math.round(clamped / 25) * 25;

  const proteinTargetG = Math.round(currentWeightKg * PROTEIN_FLOOR_G_PER_KG);

  const rationale = (() => {
    const observed = `You are averaging ${Math.round(avgDailyCalories)} kcal a day and changing weight at ${round(ratePerWeekKg)} kg per week, against a target of ${round(targetRate)} kg per week.`;
    switch (action) {
      case 'reduce-calories':
        return `${observed} Reducing intake by about ${Math.abs(calorieDeltaPerDay)} kcal a day should bring you closer to that target.`;
      case 'increase-calories':
        return `${observed} Adding about ${Math.abs(calorieDeltaPerDay)} kcal a day should bring you closer to that target.`;
      case 'increase-protein':
        return `${observed} Your rate is on target, but protein is averaging ${Math.round(avgDailyProteinG)} g a day — around ${proteinTargetG} g would better protect muscle.`;
      default:
        return `${observed} That is on target, so keep intake where it is.`;
    }
  })();

  return {
    action,
    secondaryActions: secondary,
    calorieDeltaPerDay,
    ...(secondary.includes('increase-protein') || action === 'increase-protein'
      ? { proteinTargetG }
      : {}),
    rationale,
  };
}

/**
 * Computes a trend, or explains why it cannot.
 *
 * Both arms are returned as data rather than one being an exception, so the caller
 * treats "not enough logging yet" as an ordinary state — which it is, for every new
 * user for their first fortnight.
 */
export function computeTrend(input: TrendInput): TrendResult {
  const { measurements, foodLog, goals, now, windowDays } = input;

  const windowStart = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const windowEnd = now.toISOString().slice(0, 10);

  const inWindow = measurements.filter((m) => m.date >= windowStart && m.date <= windowEnd);
  const points = latestPerDay(inWindow);

  const daysWithFoodLogs = new Set(
    foodLog.filter((f) => f.date >= windowStart && f.date <= windowEnd).map((f) => f.date),
  ).size;

  const spanDays =
    points.length >= 2
      ? toDayNumber((points.at(-1) as BodyMeasurement).date) -
        toDayNumber((points[0] as BodyMeasurement).date)
      : 0;

  const reasons: InsufficientTrendData['reasons'] = [];
  if (points.length < THRESHOLDS.minWeightEntries) reasons.push('not-enough-weight-entries');
  if (spanDays < THRESHOLDS.minSpanDays) reasons.push('span-too-short');
  if (daysWithFoodLogs < THRESHOLDS.minDaysWithFoodLogs) reasons.push('not-enough-food-logs');

  if (reasons.length > 0) {
    // The binding constraint, so the UI can name one concrete number.
    const daysNeeded = Math.max(
      THRESHOLDS.minSpanDays - spanDays,
      THRESHOLDS.minDaysWithFoodLogs - daysWithFoodLogs,
      points.length < THRESHOLDS.minWeightEntries ? 1 : 0,
    );
    return {
      status: 'insufficient-data',
      reasons,
      daysNeeded: Math.max(0, daysNeeded),
      weightEntryCount: points.length,
      daysWithFoodLogs,
    };
  }

  const first = points[0] as BodyMeasurement;
  const last = points.at(-1) as BodyMeasurement;

  const loggedDays = new Map<string, { calories: number; proteinG: number }>();
  for (const entry of foodLog) {
    if (entry.date < windowStart || entry.date > windowEnd) continue;
    const day = loggedDays.get(entry.date) ?? { calories: 0, proteinG: 0 };
    day.calories += entry.calories;
    day.proteinG += entry.proteinG;
    loggedDays.set(entry.date, day);
  }

  // Averaged over days that have any food logged, not over the whole window: a day
  // the user never opened the app is missing data, not a zero-calorie day.
  const totals = [...loggedDays.values()];
  const avgDailyCalories =
    totals.length > 0 ? totals.reduce((a, d) => a + d.calories, 0) / totals.length : 0;
  const avgDailyProteinG =
    totals.length > 0 ? totals.reduce((a, d) => a + d.proteinG, 0) / totals.length : 0;

  const ratePerWeekKg = weeklyRate(points);
  const weightChangeKg = last.weightKg - first.weightKg;

  // Intake implied by the observed change: maintenance = intake − daily surplus.
  const dailySurplus = (weightChangeKg * KCAL_PER_KG) / Math.max(1, spanDays);
  const estimatedMaintenanceCalories = Math.round(avgDailyCalories - dailySurplus);

  const direction =
    Math.abs(ratePerWeekKg) <= RATE_TOLERANCE_KG_PER_WEEK
      ? 'holding'
      : ratePerWeekKg > 0
        ? 'gaining'
        : 'losing';

  return {
    status: 'ok',
    fromDate: first.date,
    toDate: last.date,
    days: spanDays,
    startWeightKg: first.weightKg,
    endWeightKg: last.weightKg,
    weightChangeKg: round(weightChangeKg),
    ratePerWeekKg: round(ratePerWeekKg),
    direction,
    avgDailyCalories: Math.round(avgDailyCalories),
    avgDailyProteinG: Math.round(avgDailyProteinG),
    daysWithFoodLogs,
    estimatedMaintenanceCalories,
    recommendation: buildRecommendation(
      ratePerWeekKg,
      goals,
      avgDailyCalories,
      avgDailyProteinG,
      last.weightKg,
      daysWithFoodLogs,
      windowDays,
    ),
  } satisfies ComputedTrend;
}
