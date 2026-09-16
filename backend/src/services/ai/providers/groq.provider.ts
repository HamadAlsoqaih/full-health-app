/**
 * Groq provider — text only.
 *
 * `supportsVision` is false, so photo scanning correctly reports as unavailable
 * rather than silently returning a fabricated estimate when Groq is the configured
 * provider. Trend phrasing works normally.
 */
import type { ComputedTrend } from '@app/shared-types';
import { config } from '../../../config/index.js';
import { aiUnavailable } from '../../../errors.js';
import { logger } from '../../../logger.js';
import type { AiProvider, PhotoEstimate } from './ai-provider.interface.js';
import {
  BODY_COMP_SYSTEM_PROMPT,
  buildBodyCompPrompt,
} from '../prompts/body-comp-evaluation.prompt.js';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function createGroqProvider(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): AiProvider {
  const apiKey = config.ai.groqApiKey;
  if (!apiKey) throw new Error('GROQ_API_KEY is required to construct the Groq provider.');

  return {
    name: 'groq',
    supportsVision: false,

    async estimateFromPhoto(): Promise<PhotoEstimate> {
      throw aiUnavailable(
        'Photo scanning needs a vision-capable AI provider. Set AI_PROVIDER=gemini to enable it.',
      );
    },

    async phraseTrend(trend: ComputedTrend): Promise<string> {
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: config.ai.groqModel,
            temperature: 0.2,
            max_tokens: 200,
            messages: [
              { role: 'system', content: BODY_COMP_SYSTEM_PROMPT },
              { role: 'user', content: buildBodyCompPrompt(trend) },
            ],
          }),
          signal: AbortSignal.timeout(config.evaluation.providerTimeoutMs),
        });

        if (!response.ok) {
          throw aiUnavailable(`Groq responded ${response.status}.`);
        }

        const data = (await response.json()) as GroqResponse;
        const text = data.choices?.[0]?.message?.content?.trim();
        if (!text) throw aiUnavailable('Groq returned an empty summary.');
        return text;
      } catch (error) {
        logger.warn({ err: error }, 'Groq trend phrasing failed');
        throw aiUnavailable('Could not generate a summary right now.', error);
      }
    },
  };
}
