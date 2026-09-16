/**
 * Body-composition entries, the trend, and the evaluation lifecycle.
 *
 * The ordering in `recordMeasurement` is the important part:
 *
 *   1. Insert the measurement (idempotent on the client id).
 *   2. Compute the trend deterministically.
 *   3. Insert the evaluation row as `pending`, WITH that trend, synchronously.
 *   4. Respond to the client.
 *   5. Only then start the AI call, without awaiting it.
 *
 * Writing the trend before responding means the useful content is durable even if
 * the AI never answers, and the client's first poll can never race the insert and
 * see a 404.
 */
import type {
  BodyCompEvaluation,
  BodyMeasurement,
  BodyMeasurementInput,
  TrendResult,
} from '@app/shared-types';
import { config } from '../../config/index.js';
import type { Repositories } from '../../repositories/index.js';
import type { AiProvider, NotificationsPort } from '../../ports.js';
import { insertIdempotent } from '../offline-write.js';
import { computeTrend } from './trend-rules.js';
import { startEvaluation, toEvaluation } from './ai-evaluation.js';
import type { EvaluationDeps } from './ai-evaluation.js';
import type { UserPreferences } from '@app/shared-types';

export interface BodyCompDeps {
  repos: Repositories;
  ai: AiProvider;
  notifications: NotificationsPort;
  clock: () => Date;
}

/** Window used for the trend attached to a new measurement. */
const DEFAULT_WINDOW_DAYS = 30;

export async function listMeasurements(
  repos: Repositories,
  userId: string,
  limit?: number,
): Promise<BodyMeasurement[]> {
  return repos.bodyMeasurements.list(userId, limit);
}

export async function getTrend(
  deps: BodyCompDeps,
  userId: string,
  days: number,
): Promise<TrendResult> {
  const { repos, clock } = deps;
  const now = clock();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  const [measurements, foodLog, user] = await Promise.all([
    repos.bodyMeasurements.listByRange(userId, from, to),
    repos.foodLog.listByRange(userId, from, to),
    repos.users.findById(userId),
  ]);

  return computeTrend({
    measurements,
    foodLog,
    now,
    windowDays: days,
    ...(user?.goals ? { goals: user.goals as never } : {}),
  });
}

function aiEvaluationEnabled(preferences: unknown): boolean {
  const prefs = preferences as Partial<UserPreferences> | null | undefined;
  const ai = prefs?.ai;
  if (!ai) return true;
  return ai.enabled !== false && ai.evaluationEnabled !== false;
}

export async function recordMeasurement(
  deps: BodyCompDeps,
  userId: string,
  input: BodyMeasurementInput,
): Promise<{ row: BodyMeasurement; replayed: boolean }> {
  const { repos } = deps;

  const result = await insertIdempotent(
    () => repos.bodyMeasurements.insert(userId, input),
    () => repos.bodyMeasurements.findByClientId(userId, input.clientId),
  );

  // A replay must not start a second evaluation for the same measurement.
  if (result.replayed) return result;

  const trend = await getTrend(deps, userId, DEFAULT_WINDOW_DAYS);

  // No evaluation until there is enough history to evaluate. The client sees
  // status 'none' and the UI says what is still needed.
  if (trend.status !== 'ok') return result;

  const user = await repos.users.findById(userId);
  if (!aiEvaluationEnabled(user?.preferences)) return result;

  const evaluation = await repos.evaluations.insertPending({
    userId,
    measurementId: result.row.id,
    trend,
  });

  // Fire-and-forget, after the row exists and before the response is sent. The
  // client is not kept waiting on a call that takes seconds.
  startEvaluation(toEvaluationDeps(deps), evaluation.id, userId);

  return result;
}

/**
 * Returns the latest evaluation, re-firing it in the background if it has been
 * left stale.
 *
 * This is the reaper, and it lives on the read path on purpose: there is no cron
 * and no queue, so the moment the client asks is the natural moment to notice a
 * previous attempt died with the process.
 *
 * It deliberately does NOT await the retry. The client polls this endpoint, and a
 * hung provider would otherwise stall every poll for the full provider timeout —
 * so the response reports the current state immediately and the next poll picks
 * up the result. A fast 'pending' beats a twenty-second wait for the same answer.
 */
export async function getEvaluation(
  deps: BodyCompDeps,
  userId: string,
): Promise<BodyCompEvaluation> {
  const { repos, clock } = deps;
  const latest = await repos.evaluations.findLatest(userId);
  if (!latest) return { status: 'none' };

  if (latest.status === 'pending') {
    const age = clock().getTime() - new Date(latest.startedAt ?? latest.createdAt).getTime();

    if (age > config.evaluation.staleAfterMs) {
      // Out of retries: settle it as failed rather than leaving it pending
      // forever, which is exactly the state a two-value status cannot express.
      if (latest.attempts >= config.evaluation.maxAttempts) {
        await repos.evaluations.markFailed(latest.id, 'AI_UNAVAILABLE');
        return toEvaluation(await repos.evaluations.findById(userId, latest.id));
      }

      // Fire and forget. startEvaluation catches everything, so a rejection here
      // cannot escape and take the process down.
      startEvaluation(toEvaluationDeps(deps), latest.id, userId);

      // Re-read so the reported attempt count reflects the claim just made.
      return toEvaluation(await repos.evaluations.findById(userId, latest.id));
    }
  }

  return toEvaluation(latest);
}

const toEvaluationDeps = (deps: BodyCompDeps): EvaluationDeps => ({
  repos: deps.repos,
  ai: deps.ai,
  notifications: deps.notifications,
  clock: deps.clock,
});
