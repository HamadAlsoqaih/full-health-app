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
  maintenanceCalories: number;
  /** The user's saved targets, when both calories and protein are set. */
  current: MacroTargets | null;
  suggested: MacroTargets;
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

export function onTrackVerdict(trend: ComputedTrend, goals: Goals | undefined): OnTrackVerdict {
  const goal = goals?.goal ?? 'maintain';
  const target = goals?.targetRateKgPerWeek ?? DEFAULT_TARGET_RATE[goal];
  const rate = trend.ratePerWeekKg;
  const { status, title } = classify(goal, rate, target);

  const weight = trend.endWeightKg;

  // body-composition-tracker's formula: maintenance is what you eat minus the
  // energy your weight change accounts for, and the target is maintenance plus
  // the surplus or deficit the planned rate needs.
  const maintenance = trend.avgDailyCalories - (rate * KCAL_PER_KG) / 7;
  const suggestedCalories =
    status === 'on-track'
      ? round25(trend.avgDailyCalories)
      : round25(maintenance + (target * KCAL_PER_KG) / 7);

  const saved = goals?.targetProteinG;
  const suggestedProtein =
    saved !== undefined &&
    saved >= weight * PROTEIN_G_PER_KG.min &&
    saved <= weight * PROTEIN_G_PER_KG.max
      ? saved
      : Math.round(weight * PROTEIN_G_PER_KG.default);

  const current =
    goals?.targetCalories !== undefined && goals.targetProteinG !== undefined
      ? macroTargets(goals.targetCalories, goals.targetProteinG, weight)
      : null;
  const suggested = macroTargets(suggestedCalories, suggestedProtein, weight);

  const shouldChange =
    !current ||
    Math.abs(current.calories - suggested.calories) >= 50 ||
    current.proteinG !== suggested.proteinG;

  return {
    status,
    title,
    detail: explain(status, goal, rate, target),
    targetRateKgPerWeek: target,
    maintenanceCalories: Math.round(maintenance),
    current,
    suggested,
    shouldChange,
  };
}

// ---------------------------------------------------------------------------
// Insights, ported from body-composition-tracker
// ---------------------------------------------------------------------------

export interface Insight {
  id: 'logging' | 'intake' | 'protein' | 'lean-loss' | 'fat-loss' | 'recomp';
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

  // 1. Logging quality: averages are shaky below ~4 logged days a week.
  const windowDays = trend.days + 1;
  const perWeek = (trend.daysWithFoodLogs / windowDays) * 7;
  if (perWeek < 4) {
    insights.push({
      id: 'logging',
      tone: 'warn',
      text: `You logged food on ${trend.daysWithFoodLogs} of ${windowDays} days (about ${perWeek.toFixed(1)} a week). Below about 4 a week the averages, and these suggestions, are unreliable.`,
    });
  }

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
