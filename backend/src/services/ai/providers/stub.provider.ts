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
import type { AiProvider, PhotoEstimate, PhotoRefinement } from './ai-provider.interface.js';

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
        /*
         * Two fixed questions, in the exact shape the real prompt asks for.
         *
         * They are here so the whole two-pass flow — questions, answers, a
         * revised estimate — is exercisable with no API key at all. Without
         * them the entire feature would be untestable in CI, which is the gap
         * that let three real bugs through earlier.
         */
        questions: [
          {
            id: 'cooking-method',
            question: 'How was this cooked?',
            options: ['Deep fried', 'Air fried', 'Grilled', 'Not sure'],
          },
          {
            id: 'hidden-food',
            question: 'Is there more food underneath what is visible?',
            options: ['No', 'Yes, about the same again', 'Not sure'],
          },
        ],
      };
    },

    /**
     * Revises the stub estimate in a way that is visibly driven by the answers.
     *
     * Deterministic and crude on purpose: "Deep fried" adds, "Air fried"
     * subtracts, hidden food doubles. That is enough for a test to assert the
     * answers actually reached the model and changed the number, which is the
     * property that matters.
     */
    async refineFromAnswers(
      image: Buffer,
      _mimeType: string,
      refinement: PhotoRefinement,
    ): Promise<PhotoEstimate> {
      const chosen = refinement.answers.map((a) => a.answer.toLowerCase());
      let multiplier = 1;
      if (chosen.some((a) => a.includes('deep fried'))) multiplier *= 1.4;
      if (chosen.some((a) => a.includes('air fried'))) multiplier *= 0.8;
      if (chosen.some((a) => a.includes('yes'))) multiplier *= 2;

      const scale = (value: number) => Math.round(value * multiplier);
      const previous = refinement.previous.item;

      return {
        item: {
          // Same id: revised, not replaced.
          id: previous.id,
          name: previous.name,
          source: 'ai-photo-estimate',
          servingLabel: previous.servingLabel,
          calories: scale(previous.calories),
          proteinG: scale(previous.proteinG),
          carbsG: scale(previous.carbsG),
          fatG: scale(previous.fatG),
        },
        // Still low: a stub has not actually looked at anything.
        confidence: 'low',
        detectedItems: refinement.previous.detectedItems,
        questions: [],
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
