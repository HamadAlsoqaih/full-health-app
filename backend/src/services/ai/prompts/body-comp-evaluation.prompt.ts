/**
 * Prompt for rephrasing an already-computed trend.
 *
 * The model is given the finished numbers and asked only to word them. It is
 * explicitly told not to recalculate or add advice, because the arithmetic and the
 * recommendation are deterministic (spec rule 4) and an AI-invented figure here
 * would be indistinguishable from a computed one.
 */
import type { ComputedTrend } from '@app/shared-types';

export const BODY_COMP_SYSTEM_PROMPT = [
  'You rewrite fitness statistics into two or three plain sentences for the person they describe.',
  'Rules you must follow:',
  '- Use only the numbers provided. Never compute, infer, estimate or introduce a number that is not given to you.',
  '- Never contradict, soften or extend the recommendation you are given. Restate it.',
  '- Do not give medical advice, diagnose anything, or mention illness, disorders or medication.',
  '- Address the reader as "you". Be matter-of-fact and encouraging without being sentimental.',
  '- No headings, lists, emoji or markdown. Plain prose only, at most 70 words.',
].join('\n');

export function buildBodyCompPrompt(trend: ComputedTrend): string {
  return [
    `Window: ${trend.days} days (${trend.fromDate} to ${trend.toDate}).`,
    `Weight: ${trend.startWeightKg} kg to ${trend.endWeightKg} kg, a change of ${trend.weightChangeKg} kg.`,
    `Rate: ${trend.ratePerWeekKg} kg per week (${trend.direction}).`,
    `Average intake: ${trend.avgDailyCalories} kcal per day across ${trend.daysWithFoodLogs} logged days.`,
    `Average protein: ${trend.avgDailyProteinG} g per day.`,
    `Estimated maintenance: ${trend.estimatedMaintenanceCalories} kcal per day.`,
    `Recommendation to restate: ${trend.recommendation.rationale}`,
    trend.recommendation.calorieDeltaPerDay !== 0
      ? `Suggested daily change: ${trend.recommendation.calorieDeltaPerDay} kcal.`
      : 'Suggested daily change: none.',
  ].join('\n');
}
