/**
 * Meal-photo analysis.
 *
 * Synchronous by design (spec rule 2): the user is looking at a spinner, so the
 * request awaits the model rather than queueing anything.
 *
 * Two rules are enforced here rather than left to the caller:
 *
 *  - **The photo is never persisted.** It exists as a Buffer for the duration of
 *    this call and is then discarded. Nothing writes it to storage, which is also
 *    what the privacy policy states.
 *  - **The estimate is never logged automatically** (spec rule 3). It is stored as
 *    a per-user cache row and returned for confirmation. Storing it is what lets
 *    the later log call resolve macros server-side instead of trusting numbers the
 *    client sends back.
 */
import type { PhotoScanResult } from '@app/shared-types';
import { aiUnavailable, unsupportedMediaType } from '../../../errors.js';
import { config } from '../../../config/index.js';
import type { AiProvider } from '../../../ports.js';
import type { Repositories } from '../../../repositories/index.js';
import type { VisionQuota } from '../../../middlewares/rate-limit.middleware.js';

export interface PhotoAnalysisDeps {
  repos: Repositories;
  ai: AiProvider;
  quota: VisionQuota;
}

export async function analysePhoto(
  deps: PhotoAnalysisDeps,
  userId: string,
  image: Buffer,
  mimeType: string,
): Promise<PhotoScanResult> {
  // Widened: config is `as const`, so the literal tuple would reject a plain string.
  const allowed: readonly string[] = config.uploads.allowedImageTypes;
  if (!allowed.includes(mimeType)) {
    throw unsupportedMediaType(`${mimeType} is not a supported image type.`);
  }

  if (!deps.ai.supportsVision) {
    throw aiUnavailable(
      'The configured AI provider cannot analyse images. You can still log food manually.',
    );
  }

  // Account-wide daily ceiling, checked before the call. Throws AI_QUOTA_EXHAUSTED.
  deps.quota.consume();

  const estimate = await deps.ai.estimateFromPhoto(image, mimeType);

  // Persisted so the confirmation step has a server-verifiable record. The image
  // itself is not saved — only the resulting numbers.
  await deps.repos.foodCache.putEstimate(userId, estimate.item.id, estimate.item);

  return {
    estimate: estimate.item,
    confidence: estimate.confidence,
    detectedItems: estimate.detectedItems,
    // Explicit rather than implied, so the contract is visible on the wire.
    autoLogged: false,
  };
}
