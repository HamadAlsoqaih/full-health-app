/**
 * Deterministic AI provider.
 *
 * This is not a placeholder that throws — it is a real implementation selected
 * whenever the configured provider has no API key, which is the case in CI, in
 * tests and on a fresh clone. That is what lets the whole suite run credential-free
 * while the production path stays untouched.
 *
 * Its photo estimate is intentionally recognisable as a stand-in rather than
 * plausible-looking: a number that reads like a real measurement is worse than one
 * that obviously is not, because it can be mistaken for the real thing.
 */
import type { ComputedTrend } from '@app/shared-types';
import type { AiProvider, PhotoEstimate } from './ai-provider.interface.js';

export function createStubAiProvider(uuid: () => string): AiProvider {
  return {
    name: 'stub',
    supportsVision: true,

    async estimateFromPhoto(image: Buffer, _mimeType: string): Promise<PhotoEstimate> {
      // Derived from the input length only, so the same image always yields the same
      // estimate and tests are stable.
      const calories = 300 + (image.byteLength % 200);
      return {
        item: {
          id: `estimate:${uuid()}`,
          name: 'Estimated meal (no AI provider configured)',
          source: 'ai-photo-estimate',
          servingLabel: '1 serving',
          calories,
          proteinG: Math.round(calories * 0.06),
          carbsG: Math.round(calories * 0.11),
          fatG: Math.round(calories * 0.04),
        },
        confidence: 'low',
        detectedItems: ['unidentified meal'],
      };
    },

    async phraseTrend(trend: ComputedTrend): Promise<string> {
      // Mirrors the deterministic recommendation rather than inventing anything: the
      // AI layer only rephrases, it never alters the numbers (spec rule 4).
      const direction =
        trend.direction === 'losing'
          ? 'losing weight'
          : trend.direction === 'gaining'
            ? 'gaining weight'
            : 'holding steady';
      const rate = Math.abs(trend.ratePerWeekKg).toFixed(2);
      return [
        `Over the last ${trend.days} days you have been ${direction} at about ${rate} kg per week,`,
        `averaging ${Math.round(trend.avgDailyCalories)} kcal and`,
        `${Math.round(trend.avgDailyProteinG)} g of protein a day.`,
        trend.recommendation.rationale,
      ].join(' ');
    },
  };
}
