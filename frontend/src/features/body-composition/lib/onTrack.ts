/**
 * Whether the user is on track for their goal, and the targets to switch to if not.
 *
 * The logic follows body-composition-tracker: maintenance = average intake −
 * (weekly change × 7700 / 7), target = maintenance ± the planned rate × 7700 / 7,
 * protein from g/kg, fat from a 0.8 g/kg floor, carbs from what remains. The
 * weekly change is the server's fitted slope rather than first-to-last, which is
 * what keeps one noisy weigh-in from moving every number. Same 0.15 kg/week
 * on-track tolerance as backend/src/services/body-composition/trend-rules.ts.
 *
 * Suggested calories are the destination; the check-in above suggests a step of
 * at most 500 kcal toward it.
 */
import type { BodyMeasurement, ComputedTrend, Goals } from '@app/shared-types';
import { macroTargets, type MacroTargets } from '@/shared/lib/macroTargets';

const KCAL_PER_KG = 7700;
const RATE_TOLERANCE_KG_PER_WEEK = 0.15;
/**
 * Protein, g per kg of body weight. 1.6 is where extra protein stopped adding
 * lean mass in Morton et al. (Br J Sports Med 2018), whose upper estimate was
 * 2.2; body-composition-tracker defaults to 1.8 while losing fat. A saved target
 * inside 1.6–2.2 is kept; anything outside is replaced with 1.8.
 */
export const PROTEIN_G_PER_KG = { min: 1.6, default: 1.8, max: 2.2 } as const;
/** Intake within this of the calorie target counts as hitting it. */
export const INTAKE_TOLERANCE_KCAL = 100;

export const DEFAULT_TARGET_RATE: Record<Goals['goal'], number> = {
  cut: -0.5,
  bulk: 0.25,
  maintain: 0,
};

export type OnTrackStatus = 'on-track' | 'too-fast' | 'too-slow' | 'wrong-way';

export interface OnTrackVerdict {
  status: OnTrackStatus;
  title: string;
  detail: string;
  targetRateKgPerWeek: number;
  /** Average intake minus the energy the fitted weight change accounts for. */
  measuredMaintenanceCalories: number;
  /** Measured, blended with the formula while the trend is under four weeks old. */
  maintenanceCalories: number;
  /** Share of maintenance taken from the measured trend, 0–1. */
  blendWeight: number;
  /** The user's saved targets, when both calories and protein are set. */
  current: MacroTargets | null;
  /** This week's targets: at most MAX_WEEKLY_STEP_KCAL from current intake. */
  suggested: MacroTargets;
  /** Where the weekly steps are heading. */
  goal: MacroTargets;
  /** Weeks of steps to reach the goal, counting this one; 1 when this week is the goal. */
  weeksToGoal: number;
  /** True when the suggestion differs enough from the current targets to act on. */
  shouldChange: boolean;
}

const round25 = (n: number) => Math.round(n / 25) * 25;
const fmt = (kg: number) => `${kg > 0 ? '+' : ''}${kg.toFixed(2)} kg/week`;

function classify(goal: Goals['goal'], rate: number, target: number) {
  const tol = RATE_TOLERANCE_KG_PER_WEEK;
  if (Math.abs(rate - target) <= tol) {
    return { status: 'on-track' as const, title: 'On track' };
  }
  if (goal === 'cut') {
    if (rate < target) return { status: 'too-fast' as const, title: 'Losing faster than planned' };
    if (rate > tol) return { status: 'wrong-way' as const, title: 'Gaining instead of losing' };
    if (rate >= -tol) return { status: 'wrong-way' as const, title: 'Weight has stalled' };
    return { status: 'too-slow' as const, title: 'Losing slower than planned' };
  }
  if (goal === 'bulk') {
    if (rate > target) return { status: 'too-fast' as const, title: 'Gaining faster than planned' };
    if (rate < -tol) return { status: 'wrong-way' as const, title: 'Losing instead of gaining' };
    if (rate <= tol) return { status: 'wrong-way' as const, title: 'Weight has stalled' };
    return { status: 'too-slow' as const, title: 'Gaining slower than planned' };
  }
  return rate > target
    ? { status: 'wrong-way' as const, title: 'Gaining while maintaining' }
    : { status: 'wrong-way' as const, title: 'Losing while maintaining' };
}

function explain(status: OnTrackStatus, goal: Goals['goal'], rate: number, target: number) {
  const observed = `You're changing at ${fmt(rate)} against a plan of ${fmt(target)}.`;
  switch (status) {
    case 'on-track':
      return `${observed} What you're eating is working, so keep it there.`;
    case 'too-fast':
      return goal === 'cut'
        ? `${observed} Losing this fast makes it harder to keep muscle and to stick with the diet. Eat more.`
        : `${observed} Gaining this fast usually means more of the gain is fat. Eat a little less.`;
    case 'too-slow':
      return goal === 'cut'
        ? `${observed} You're heading the right way, just slowly. A small cut in calories closes the gap.`
        : `${observed} You're heading the right way, just slowly. A small increase closes the gap.`;
    default:
      return `${observed} Your intake needs to change to move in the right direction.`;
  }
}

/** Largest change to daily calories in one week, so a correction is livable. */
export const MAX_WEEKLY_STEP_KCAL = 500;
/** Days of measured trend after which the formula no longer counts at all. */
export const FULL_TRUST_DAYS = 28;

function proteinFor(weightKg: number, saved: number | undefined): number {
  return saved !== undefined &&
    saved >= weightKg * PROTEIN_G_PER_KG.min &&
    saved <= weightKg * PROTEIN_G_PER_KG.max
    ? saved
    : Math.round(weightKg * PROTEIN_G_PER_KG.default);
}

export interface VerdictOptions {
  /** Mifflin-St Jeor estimate, when the user has filled in their body profile. */
  formulaMaintenance?: number;
}

export function onTrackVerdict(
  trend: ComputedTrend,
  goals: Goals | undefined,
  options: VerdictOptions = {},
): OnTrackVerdict {
  const goal = goals?.goal ?? 'maintain';
  const target = goals?.targetRateKgPerWeek ?? DEFAULT_TARGET_RATE[goal];
  const rate = trend.ratePerWeekKg;
  const { status, title } = classify(goal, rate, target);
  const weight = trend.endWeightKg;

  // body-composition-tracker's formula: maintenance is what you eat minus the
  // energy your weight change accounts for. The server computes exactly this
  // from the fitted rate; using its figure keeps both cards on one number.
  const measured = trend.estimatedMaintenanceCalories;

  // Blended with the formula while the trend is young: a two-week trend is
  // still noisy, a four-week one is not. Without a formula, measured alone.
  const { formulaMaintenance } = options;
  const blendWeight =
    formulaMaintenance === undefined ? 1 : Math.min(1, trend.days / FULL_TRUST_DAYS);
  const maintenance =
    formulaMaintenance === undefined
      ? measured
      : blendWeight * measured + (1 - blendWeight) * formulaMaintenance;

  // The destination, then this week's step toward it from what is eaten now.
  const goalCalories =
    status === 'on-track'
      ? round25(trend.avgDailyCalories)
      : round25(maintenance + (target * KCAL_PER_KG) / 7);
  const from = trend.avgDailyCalories;
  const thisWeekCalories = round25(
    Math.max(from - MAX_WEEKLY_STEP_KCAL, Math.min(from + MAX_WEEKLY_STEP_KCAL, goalCalories)),
  );
  const weeksToGoal = Math.max(
    1,
    Math.ceil((Math.abs(goalCalories - from) - 12.5) / MAX_WEEKLY_STEP_KCAL),
  );

  const protein = proteinFor(weight, goals?.targetProteinG);
  const current =
    goals?.targetCalories !== undefined && goals.targetProteinG !== undefined
      ? macroTargets(goals.targetCalories, goals.targetProteinG, weight)
      : null;
  const thisWeek = macroTargets(thisWeekCalories, protein, weight);
  const goalTargets = macroTargets(goalCalories, protein, weight);

  const shouldChange =
    !current ||
    Math.abs(current.calories - thisWeek.calories) >= 50 ||
    current.proteinG !== thisWeek.proteinG;

  return {
    status,
    title,
    detail: explain(status, goal, rate, target),
    targetRateKgPerWeek: target,
    measuredMaintenanceCalories: Math.round(measured),
    maintenanceCalories: Math.round(maintenance),
    blendWeight,
    current,
    suggested: thisWeek,
    goal: goalTargets,
    weeksToGoal: goalCalories === thisWeekCalories ? 1 : weeksToGoal,
    shouldChange,
  };
}

// ---------------------------------------------------------------------------
// Starting targets, before there is a trend
// ---------------------------------------------------------------------------

export interface StartingTargets {
  maintenanceCalories: number;
  targetRateKgPerWeek: number;
  targets: MacroTargets;
}

/** Formula-only targets for a new user: maintenance ± the planned rate. */
export function startingTargets(
  formulaMaintenance: number,
  weightKg: number,
  goals: Goals | undefined,
): StartingTargets {
  const goal = goals?.goal ?? 'maintain';
  const target = goals?.targetRateKgPerWeek ?? DEFAULT_TARGET_RATE[goal];
  const calories = round25(formulaMaintenance + (target * KCAL_PER_KG) / 7);
  return {
    maintenanceCalories: formulaMaintenance,
    targetRateKgPerWeek: target,
    targets: macroTargets(calories, proteinFor(weightKg, goals?.targetProteinG), weightKg),
  };
}

// ---------------------------------------------------------------------------
// Insights, ported from body-composition-tracker
// ---------------------------------------------------------------------------

export interface Insight {
  id: 'intake' | 'protein' | 'carbs' | 'lean-loss' | 'fat-loss' | 'recomp';
  tone: 'good' | 'warn' | 'info';
  text: string;
}

const kg = (n: number) => `${Math.abs(n).toFixed(1)} kg`;

/**
 * Plain-language observations beyond the verdict.
 *
 * Lean mass is weight minus fat mass (weight × body fat %). It includes water
 * and glycogen as well as muscle, which is why it is called lean mass here and
 * why a scale-based body-fat reading makes this a rough signal, not a measurement.
 */
export function bodyInsights(
  trend: ComputedTrend,
  measurements: BodyMeasurement[],
  verdict: OnTrackVerdict,
): Insight[] {
  const insights: Insight[] = [];
  const inWindow = measurements
    .filter((m) => m.date >= trend.fromDate && m.date <= trend.toDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 2. Hitting the calorie target.
  if (verdict.current) {
    const gap = trend.avgDailyCalories - verdict.current.calories;
    if (Math.abs(gap) >= INTAKE_TOLERANCE_KCAL && verdict.status !== 'on-track') {
      insights.push({
        id: 'intake',
        tone: 'warn',
        text: `You're eating about ${Math.round(Math.abs(gap))} kcal a day ${gap > 0 ? 'over' : 'under'} your target. Hitting the target matters as much as the target itself.`,
      });
    }
  }

  // 3. Protein.
  const proteinTarget = verdict.suggested.proteinG;
  if (trend.avgDailyProteinG < proteinTarget - 5) {
    insights.push({
      id: 'protein',
      tone: 'warn',
      text: `Protein is low: ${trend.avgDailyProteinG} g a day against ${proteinTarget} g. Raise it to protect muscle, especially in a deficit.`,
    });
  }

  // BCT's carb check: protein and fat floors can crowd carbs out at low calories.
  if (verdict.suggested.carbsG < 50) {
    insights.push({
      id: 'carbs',
      tone: 'warn',
      text: `Your protein and fat targets leave little room for carbs (~${verdict.suggested.carbsG} g). Fine short-term, but low carbs can flatten training. Consider a small calorie increase or less fat.`,
    });
  }

  // 4. Lean vs fat share of the change, from body-fat readings.
  const withFat = inWindow.filter((m) => m.bodyFatPct !== undefined);
  const first = withFat[0];
  const last = withFat.at(-1);
  if (first && last && first !== last) {
    const fat = (m: BodyMeasurement) => (m.weightKg * (m.bodyFatPct as number)) / 100;
    const dFat = fat(last) - fat(first);
    const dLean = last.weightKg - fat(last) - (first.weightKg - fat(first));
    const totalLoss = first.weightKg - last.weightKg;
    if (totalLoss > 0.5) {
      const leanShare = -dLean / totalLoss;
      if (dLean < 0 && leanShare > 0.35) {
        insights.push({
          id: 'lean-loss',
          tone: 'warn',
          text: `About ${Math.round(leanShare * 100)}% of the ${kg(totalLoss)} you lost was lean mass, not fat. That's high: slow the deficit, push protein toward 2.0 g/kg and keep resistance training hard.`,
        });
      } else if (dLean >= 0 && dFat < 0) {
        insights.push({
          id: 'fat-loss',
          tone: 'good',
          text: `Fat down ${kg(dFat)} with lean mass holding. This is exactly what you want, so keep the current approach.`,
        });
      }
    }
  }

  // 5. Recomposition: weight flat, waist down.
  const withWaist = inWindow.filter((m) => m.tapeCm?.waist !== undefined);
  const w0 = withWaist[0];
  const w1 = withWaist.at(-1);
  if (w0 && w1 && w0 !== w1) {
    const dWaist = (w1.tapeCm?.waist as number) - (w0.tapeCm?.waist as number);
    const dWeight = w1.weightKg - w0.weightKg;
    if (Math.abs(dWeight) < 1 && dWaist <= -1.5) {
      insights.push({
        id: 'recomp',
        tone: 'good',
        text: `Weight is flat but your waist dropped ${Math.abs(dWaist).toFixed(1)} cm. That's recomposition, losing fat while holding mass, and the scale is hiding it.`,
      });
    }
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Logging reliability
// ---------------------------------------------------------------------------

export type Reliability = 'high' | 'medium' | 'low';

export interface LoggingReliability {
  level: Reliability;
  /**
   * Measured maintenance is so far under the formula that food is very likely
   * going unlogged. New targets built on those logs would be wrong, so the card
   * holds them back until logging is fixed.
   */
  underLogging: boolean;
  /** ± kcal to show around the goal, wider as the logs get less trustworthy. */
  rangeKcal: number;
  reasons: string[];
}

const RANGE_KCAL: Record<Reliability, number> = { high: 100, medium: 200, low: 350 };
/** Measured maintenance this far under the formula points to under-logging. */
const UNDER_LOGGING_RATIO = 0.75;

/**
 * How far the logs can be trusted.
 *
 * Under-logging by the same amount every day cancels out — maintenance is worked
 * out from logged intake, so the target comes out in the same "logged calories".
 * What does not cancel is logging that varies, and that leaves traces: partial
 * days, gaps that fall on the weekend, and a measured maintenance far below what
 * any formula would give. None of them is proof; each lowers confidence.
 */
export function loggingReliability(
  trend: ComputedTrend,
  formulaMaintenance: number | undefined,
  measuredMaintenance: number,
): LoggingReliability {
  const reasons: string[] = [];
  let severe = false;

  const windowDays = trend.days + 1;
  const perWeek = (trend.daysWithFoodLogs / windowDays) * 7;
  if (perWeek < 4) {
    reasons.push(
      `Food logged on ${trend.daysWithFoodLogs} of ${windowDays} days (about ${perWeek.toFixed(1)} a week). Below about 4 a week the averages are shaky.`,
    );
  }

  if (trend.partialDays.length >= 2) {
    reasons.push(
      `${trend.partialDays.length} days look only partly logged (under 60% of your usual intake), so they were left out of the average.`,
    );
  }

  // Gaps on Friday and Saturday, the Saudi weekend, are usually the big days.
  const logged = new Set(trend.dailyCalories.map((d) => d.date));
  const missing: number[] = [];
  for (
    let t = Date.parse(`${trend.fromDate}T00:00:00Z`);
    t <= Date.parse(`${trend.toDate}T00:00:00Z`);
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (!logged.has(date)) missing.push(new Date(t).getUTCDay());
  }
  const weekendMissing = missing.filter((d) => d === 5 || d === 6).length;
  if (missing.length >= 3 && weekendMissing / missing.length >= 0.6) {
    reasons.push(
      `${weekendMissing} of your ${missing.length} unlogged days are Fridays or Saturdays. Weekends tend to be the bigger days, so your real average is probably higher than logged.`,
    );
  }

  if (
    formulaMaintenance !== undefined &&
    measuredMaintenance < formulaMaintenance * UNDER_LOGGING_RATIO
  ) {
    severe = true;
    reasons.push(
      `Your measured maintenance (${measuredMaintenance} kcal) is ${Math.round((1 - measuredMaintenance / formulaMaintenance) * 100)}% below the formula's ${formulaMaintenance} kcal. Formulas are rough, but a gap this size usually means food is going unlogged: oil, drinks, snacks, bites.`,
    );
  }

  const level: Reliability =
    severe || reasons.length >= 2 ? 'low' : reasons.length === 1 ? 'medium' : 'high';
  return { level, underLogging: severe, rangeKcal: RANGE_KCAL[level], reasons };
}
