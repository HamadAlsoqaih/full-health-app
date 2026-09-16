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
import type { AiProvider, PhotoEstimate } from './ai-provider.interface.js';
import { NUTRITION_PHOTO_SYSTEM_PROMPT } from '../prompts/nutrition-photo.prompt.js';
import {
  BODY_COMP_SYSTEM_PROMPT,
  buildBodyCompPrompt,
} from '../prompts/body-comp-evaluation.prompt.js';
import { parsePhotoEstimate } from '../vision/parse-estimate.js';

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
        const response = await client.models.generateContent({
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
        });

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
        return { item, confidence: parsed.confidence, detectedItems: parsed.detectedItems };
      } catch (error) {
        logger.warn({ err: error }, 'Gemini photo estimate failed');
        throw aiUnavailable('Could not analyse that photo right now.', error);
      }
    },

    async phraseTrend(trend: ComputedTrend): Promise<string> {
      try {
        const response = await client.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [{ text: BODY_COMP_SYSTEM_PROMPT }, { text: buildBodyCompPrompt(trend) }],
            },
          ],
          config: { temperature: 0.2 },
        });
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
