/**
 * Whether the user is on track for their goal, and the targets to switch to if not.
 *
 * Pure arithmetic over the server's computed trend, using the same tolerance,
 * energy constant and protein floor as
 * backend/src/services/body-composition/trend-rules.ts.
 *
 * Suggested calories are estimated maintenance plus the daily surplus or deficit
 * the planned rate needs (rate × 7700 / 7). That is the destination; the
 * check-in above suggests a step of at most 500 kcal toward it. Basing it on the
 * target instead would be wrong whenever the user is not eating to their target,
 * which is exactly when the trend is off.
 */
import type { ComputedTrend, Goals } from '@app/shared-types';
import { macroTargets, type MacroTargets } from '@/shared/lib/macroTargets';

const KCAL_PER_KG = 7700;
const RATE_TOLERANCE_KG_PER_WEEK = 0.15;
const PROTEIN_FLOOR_G_PER_KG = 1.6;

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

  // On track: what they already eat is producing the planned rate, so keep it.
  const suggestedCalories =
    status === 'on-track'
      ? round25(trend.avgDailyCalories)
      : round25(trend.estimatedMaintenanceCalories + (target * KCAL_PER_KG) / 7);

  const proteinFloor = Math.round(trend.endWeightKg * PROTEIN_FLOOR_G_PER_KG);
  const suggestedProtein = Math.max(goals?.targetProteinG ?? 0, proteinFloor);

  const current =
    goals?.targetCalories !== undefined && goals.targetProteinG !== undefined
      ? macroTargets(goals.targetCalories, goals.targetProteinG)
      : null;
  const suggested = macroTargets(suggestedCalories, suggestedProtein);

  const shouldChange =
    !current ||
    Math.abs(current.calories - suggested.calories) >= 50 ||
    current.proteinG !== suggested.proteinG;

  return {
    status,
    title,
    detail: explain(status, goal, rate, target),
    targetRateKgPerWeek: target,
    current,
    suggested,
    shouldChange,
  };
}
