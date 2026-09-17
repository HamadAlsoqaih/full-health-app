/**
 * Google Gemini provider. Handles both vision (meal photos) and text (trend phrasing).
 *
 * Could not be exercised against the live API from the build environment, so the
 * response parsing is defensive: a model that returns prose around its JSON, or a
 * field as a string instead of a number, is coerced rather than crashing a request.
 */
import { GoogleGenAI } from '@google/genai';
import type { ComputedTrend, FoodItem } from '@app/shared-types';
import { config } from '../../../config/index.js';
import { aiUnavailable } from '../../../errors.js';
import { logger } from '../../../logger.js';
import type { AiProvider, PhotoEstimate, PhotoRefinement } from './ai-provider.interface.js';
import {
  NUTRITION_PHOTO_SYSTEM_PROMPT,
  NUTRITION_REFINE_SYSTEM_PROMPT,
  buildRefinePrompt,
} from '../prompts/nutrition-photo.prompt.js';
import {
  BODY_COMP_SYSTEM_PROMPT,
  buildBodyCompPrompt,
} from '../prompts/body-comp-evaluation.prompt.js';
import { parsePhotoEstimate } from '../vision/parse-estimate.js';
import { retryTransient } from '../retry.js';

export function createGeminiProvider(uuid: () => string): AiProvider {
  const apiKey = config.ai.geminiApiKey;
  if (!apiKey) {
    // Unreachable in practice: config falls back to the stub when the key is
    // absent. Kept so a direct caller fails loudly rather than sending no key.
    throw new Error('GEMINI_API_KEY is required to construct the Gemini provider.');
  }

  const client = new GoogleGenAI({ apiKey });
  const model = config.ai.geminiModel;

  return {
    name: 'gemini',
    supportsVision: true,

    async estimateFromPhoto(image: Buffer, mimeType: string): Promise<PhotoEstimate> {
      try {
        // Retried only on a transient failure — a demand spike or a dropped
        // connection. A retired model or a rejected key fails once, with the
        // real reason, because retrying those only delays the truth.
        const response = await retryTransient(
          () =>
            client.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: NUTRITION_PHOTO_SYSTEM_PROMPT },
                    { inlineData: { mimeType, data: image.toString('base64') } },
                  ],
                },
              ],
              config: { temperature: 0, responseMimeType: 'application/json' },
            }),
          { label: 'gemini.estimateFromPhoto' },
        );

        const text = response.text ?? '';
        const parsed = parsePhotoEstimate(text);
        if (!parsed) throw aiUnavailable('The AI response could not be understood.');

        const item: FoodItem = {
          id: `estimate:${uuid()}`,
          name: parsed.name,
          source: 'ai-photo-estimate',
          servingLabel: parsed.servingLabel,
          calories: parsed.calories,
          proteinG: parsed.proteinG,
          carbsG: parsed.carbsG,
          fatG: parsed.fatG,
        };
        return {
          item,
          confidence: parsed.confidence,
          detectedItems: parsed.detectedItems,
          questions: parsed.questions,
        };
      } catch (error) {
        logger.warn({ err: error }, 'Gemini photo estimate failed');
        throw aiUnavailable('Could not analyse that photo right now.', error);
      }
    },

    /**
     * Second pass: same image, plus the answers.
     *
     * The photo is sent again rather than the model reasoning from its own
     * earlier text. "8 pieces" is only useful if it can look at the bucket while
     * recalculating, and this is its one chance to notice it called wings thighs.
     *
     * The id is carried over from the first estimate, so the cache row the
     * confirmation step resolves against is replaced rather than duplicated.
     */
    async refineFromAnswers(
      image: Buffer,
      mimeType: string,
      refinement: PhotoRefinement,
    ): Promise<PhotoEstimate> {
      try {
        const response = await retryTransient(
          () =>
            client.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: NUTRITION_REFINE_SYSTEM_PROMPT },
                    { inlineData: { mimeType, data: image.toString('base64') } },
                    {
                      text: buildRefinePrompt({
                        previous: {
                          name: refinement.previous.item.name,
                          servingLabel: refinement.previous.item.servingLabel,
                          calories: refinement.previous.item.calories,
                          proteinG: refinement.previous.item.proteinG,
                          carbsG: refinement.previous.item.carbsG,
                          fatG: refinement.previous.item.fatG,
                        },
                        answers: refinement.answers,
                        ...(refinement.note ? { note: refinement.note } : {}),
                      }),
                    },
                  ],
                },
              ],
              config: { temperature: 0, responseMimeType: 'application/json' },
            }),
          { label: 'gemini.refineFromAnswers' },
        );

        const parsed = parsePhotoEstimate(response.text ?? '');
        if (!parsed) throw aiUnavailable('The AI response could not be understood.');

        return {
          item: {
            // Same id as the first pass: the estimate was revised, not replaced.
            id: refinement.previous.item.id,
            name: parsed.name,
            source: 'ai-photo-estimate',
            servingLabel: parsed.servingLabel,
            calories: parsed.calories,
            proteinG: parsed.proteinG,
            carbsG: parsed.carbsG,
            fatG: parsed.fatG,
          },
          confidence: parsed.confidence,
          detectedItems: parsed.detectedItems,
          // No second round of questions. One round is the deal; asking again
          // would turn logging a meal into an interrogation.
          questions: [],
        };
      } catch (error) {
        logger.warn({ err: error }, 'Gemini estimate refinement failed');
        throw aiUnavailable('Could not update that estimate right now.', error);
      }
    },

    async phraseTrend(trend: ComputedTrend): Promise<string> {
      try {
        const response = await retryTransient(
          () =>
            client.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [{ text: BODY_COMP_SYSTEM_PROMPT }, { text: buildBodyCompPrompt(trend) }],
                },
              ],
              config: { temperature: 0.2 },
            }),
          { label: 'gemini.phraseTrend' },
        );
        const text = (response.text ?? '').trim();
        if (!text) throw aiUnavailable('The AI returned an empty summary.');
        return text;
      } catch (error) {
        logger.warn({ err: error }, 'Gemini trend phrasing failed');
        throw aiUnavailable('Could not generate a summary right now.', error);
      }
    },
  };
}
