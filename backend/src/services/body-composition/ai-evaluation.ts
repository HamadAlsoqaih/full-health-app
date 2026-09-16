/**
 * The AI phrasing of a computed trend, run asynchronously without a queue.
 *
 * One job type does not justify BullMQ and a Redis dependency, so this is a plain
 * async function started without being awaited. That choice has three consequences
 * that have to be handled explicitly, and are:
 *
 * 1. **An escaping rejection would kill the process.** An unawaited promise that
 *    rejects triggers `unhandledRejection`. So `run` never throws: it always writes
 *    a terminal state and swallows what it cannot.
 *
 * 2. **The process can die mid-call.** Free-tier hosting sleeps when idle, taking
 *    an in-flight call with it and leaving the row `pending` forever. The reaper in
 *    `getEvaluation` re-fires a stale pending row, bounded by an attempt ceiling.
 *
 * 3. **Concurrent polls could double-fire.** Every transition goes through a
 *    conditional update that returns whether it won, so the AI call and the
 *    notification each happen once.
 *
 * The deterministic trend is written before any of this begins, so the numbers are
 * durable even when the AI never answers.
 */
import type { BodyCompEvaluation, ComputedTrend } from '@app/shared-types';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';
import { captureException } from '../../sentry.js';
import type { AiProvider, NotificationsPort } from '../../ports.js';
import type { Repositories } from '../../repositories/index.js';
import { notify } from '../notifications/notifications.service.js';

export interface EvaluationDeps {
  repos: Repositories;
  ai: AiProvider;
  notifications: NotificationsPort;
  clock: () => Date;
}

/**
 * Runs one evaluation to a terminal state. Never throws.
 *
 * Returns the resulting evaluation so the reaper can answer the request that
 * triggered it with a fresh value rather than a stale one.
 */
export async function runEvaluation(
  deps: EvaluationDeps,
  evaluationId: string,
  userId: string,
): Promise<BodyCompEvaluation> {
  const { repos, ai, clock } = deps;

  const staleBefore = new Date(clock().getTime() - config.evaluation.staleAfterMs);
  const claimed = await repos.evaluations.claimForRun(
    evaluationId,
    staleBefore,
    config.evaluation.maxAttempts,
  );

  if (!claimed) {
    // Someone else is already working on it, it already finished, or it has
    // exhausted its attempts. Report whatever the current state is.
    const current = await repos.evaluations.findById(userId, evaluationId);
    return toEvaluation(current);
  }

  const trend = claimed.trend;
  if (trend.status !== 'ok') {
    // Nothing to phrase. Should not happen — a pending row is only created from a
    // computed trend — but failing loudly beats leaving it pending forever.
    await repos.evaluations.markFailed(evaluationId, 'INTERNAL');
    return toEvaluation(await repos.evaluations.findById(userId, evaluationId));
  }

  try {
    const summary = await withTimeout(
      () => ai.phraseTrend(trend as ComputedTrend),
      config.evaluation.providerTimeoutMs,
    );

    // Conditional: only the winner of pending → ready notifies, so a retry or a
    // concurrent poll cannot send the notification twice.
    const won = await repos.evaluations.markReady(
      evaluationId,
      summary.trim(),
      ai.name,
      providerModel(ai),
    );

    if (won) {
      await notify(repos, deps.notifications, 'evaluation-ready', userId, {
        evaluationId,
      });
    }
  } catch (error) {
    logger.warn({ err: error, evaluationId }, 'AI evaluation failed');
    captureException(error, { evaluationId, stage: 'ai-evaluation' });

    // Left pending while attempts remain, so the reaper can retry; marked failed
    // once the ceiling is reached, so it never sits pending indefinitely.
    if (claimed.attempts >= config.evaluation.maxAttempts) {
      await repos.evaluations.markFailed(evaluationId, 'AI_UNAVAILABLE');
    }
  }

  return toEvaluation(await repos.evaluations.findById(userId, evaluationId));
}

/**
 * Starts an evaluation and returns immediately.
 *
 * The `.catch` is not optional decoration: without it a rejection here becomes an
 * unhandled rejection and takes the process down.
 */
export function startEvaluation(deps: EvaluationDeps, evaluationId: string, userId: string): void {
  void runEvaluation(deps, evaluationId, userId).catch((error: unknown) => {
    logger.error({ err: error, evaluationId }, 'evaluation runner escaped');
    captureException(error, { evaluationId, stage: 'evaluation-runner' });
  });
}

function providerModel(ai: AiProvider): string {
  if (ai.name === 'gemini') return config.ai.geminiModel;
  if (ai.name === 'groq') return config.ai.groqModel;
  return 'stub';
}

/** Rejects with a TimeoutError so a hung provider cannot outlive the transition. */
async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          const error = new Error(`AI provider did not respond within ${ms}ms`);
          error.name = 'TimeoutError';
          reject(error);
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Maps a stored row to the wire shape, including the absent case. */
export function toEvaluation(
  row: Awaited<ReturnType<Repositories['evaluations']['findById']>>,
): BodyCompEvaluation {
  if (!row) return { status: 'none' };
  return {
    status: row.status,
    measurementId: row.measurementId,
    // Always returned, so the UI can show the deterministic numbers even when the
    // prose is pending or failed.
    trend: row.trend,
    createdAt: row.createdAt,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt } : {}),
    ...(row.errorCode ? { errorCode: row.errorCode as BodyCompEvaluation['errorCode'] } : {}),
  };
}
