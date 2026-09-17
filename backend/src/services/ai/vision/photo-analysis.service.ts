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
import type { PhotoRefineInput, PhotoRefineResult, PhotoScanResult } from '@app/shared-types';
import { aiUnavailable, notFound, unsupportedMediaType } from '../../../errors.js';
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
    ...(estimate.questions.length > 0 ? { questions: estimate.questions } : {}),
    // Explicit rather than implied, so the contract is visible on the wire.
    autoLogged: false,
  };
}

/**
 * Second pass: the same photo, with the questions answered.
 *
 * Why the photo comes back up the wire rather than being cached between calls:
 * nothing about retention changes. The browser still holds the file and re-sends
 * it; the server holds it for the length of one request and writes it nowhere,
 * exactly as on the first pass.
 *
 * The previous estimate is read from the user's own cache rather than trusted
 * from the request body. A client could otherwise claim any starting numbers it
 * liked and have the model "revise" toward them — and the whole reason the
 * estimate is cached is so the eventual log resolves macros server-side instead
 * of believing what the client sends back.
 */
export async function refinePhotoEstimate(
  deps: PhotoAnalysisDeps,
  userId: string,
  image: Buffer,
  mimeType: string,
  input: PhotoRefineInput,
): Promise<PhotoRefineResult> {
  const allowed: readonly string[] = config.uploads.allowedImageTypes;
  if (!allowed.includes(mimeType)) {
    throw unsupportedMediaType(`${mimeType} is not a supported image type.`);
  }

  if (!deps.ai.supportsVision) {
    throw aiUnavailable(
      'The configured AI provider cannot analyse images. You can still log food manually.',
    );
  }

  const cached = await deps.repos.foodCache.getEstimate(userId, input.previousEstimateId);
  if (!cached) {
    throw notFound('That estimate has expired. Scan the photo again.');
  }

  // Counts against the account-wide daily ceiling like any other vision call: it
  // is a second real call to the model, and pretending otherwise would let the
  // shared free-tier allowance be drained at twice the expected rate.
  deps.quota.consume();

  const refined = await deps.ai.refineFromAnswers(image, mimeType, {
    previous: { item: cached, confidence: 'low', detectedItems: [], questions: [] },
    // Only answered questions are sent. An unanswered one is not the same as
    // "not sure" — the model should simply not hear about it.
    answers: input.answers
      .filter(
        (answer): answer is { questionId: string; question: string; option: string } =>
          answer.option !== null,
      )
      .map((answer) => ({ question: answer.question, answer: answer.option })),
    ...(input.note ? { note: input.note } : {}),
  });

  // Replaces the cache row under the same id, so the confirmation step resolves
  // the revised numbers rather than the ones that have just been superseded.
  await deps.repos.foodCache.putEstimate(userId, refined.item.id, refined.item);

  return {
    estimate: refined.item,
    confidence: refined.confidence,
    detectedItems: refined.detectedItems,
    previousCalories: cached.calories,
    autoLogged: false,
  };
}
