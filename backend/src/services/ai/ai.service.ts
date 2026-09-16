/**
 * Provider selection.
 *
 * `AI_PROVIDER` chooses, but a provider whose key is missing is never constructed —
 * config resolves that case to the stub. So this cannot throw at startup for want
 * of a credential, which is what keeps a keyless clone runnable.
 */
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';
import type { AiProvider } from '../../ports.js';
import { createGeminiProvider } from './providers/gemini.provider.js';
import { createGroqProvider } from './providers/groq.provider.js';
import { createStubAiProvider } from './providers/stub.provider.js';

export function createAiProvider(uuid: () => string): AiProvider {
  switch (config.ai.provider) {
    case 'gemini':
      return createGeminiProvider(uuid);
    case 'groq':
      return createGroqProvider();
    default:
      if (config.ai.requestedProvider !== 'stub') {
        logger.warn(
          { requested: config.ai.requestedProvider },
          'AI provider has no API key configured; using the deterministic stub instead',
        );
      }
      return createStubAiProvider(uuid);
  }
}
