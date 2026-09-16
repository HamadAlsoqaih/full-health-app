/**
 * Idempotency for offline-syncable writes.
 *
 * The client mints a UUID per queued write and resends it until the server
 * acknowledges. Without deduplication, a flaky reconnect turns one logged workout
 * into five.
 *
 * Contract on a replay: **200 with the stored resource**, plus an
 * `Idempotent-Replay: true` header.
 *
 *  - Not 201, because nothing was created this time.
 *  - Not 409, because the client did nothing wrong. A conflict would make the
 *    outbox treat the item as failed and retry it forever.
 *
 * The body is byte-identical to the original 201 response, so the client needs no
 * special case: it drops the queue item either way.
 *
 * This middleware is only a fast path. Read-then-write is not atomic, so two
 * concurrent flushes can both miss here — the unique constraint on
 * (user_id, client_id) is the actual guarantee, and the service layer converts its
 * violation into the same 200. See services/offline-write.ts.
 */
import type { RequestHandler } from 'express';
import type { Repositories } from '../repositories/index.js';
import { currentRepos, currentUser } from './auth.middleware.js';

/** Finds an already-stored row for this user and client id, or null. */
export type ReplayFinder = (
  repos: Repositories,
  userId: string,
  clientId: string,
) => Promise<unknown | null>;

export function idempotency(find: ReplayFinder): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      try {
        const clientId = (req.body as { clientId?: unknown } | undefined)?.clientId;
        if (typeof clientId !== 'string' || !clientId) {
          // Validation runs before this and requires clientId on these routes, so a
          // missing one means a route was wired without it. Pass through rather than
          // silently deduplicating nothing.
          next();
          return;
        }

        const existing = await find(currentRepos(req), currentUser(req).id, clientId);
        if (!existing) {
          next();
          return;
        }

        res.setHeader('Idempotent-Replay', 'true');
        res.status(200).json(existing);
      } catch (error) {
        next(error);
      }
    })();
  };
}

/**
 * The finders, one per offline-syncable resource.
 *
 * Key space is per resource, not shared: the same clientId may legitimately appear
 * on a workout log and a custom food. A single shared idempotency-keys table would
 * need its own retention and garbage collection for no benefit here.
 */
export const replayFinders = {
  workoutLog: ((repos, userId, clientId) =>
    repos.workoutLogs.findByClientId(userId, clientId)) satisfies ReplayFinder,
  customFood: ((repos, userId, clientId) =>
    repos.customFoods.findByClientId(userId, clientId)) satisfies ReplayFinder,
  foodLog: ((repos, userId, clientId) =>
    repos.foodLog.findByClientId(userId, clientId)) satisfies ReplayFinder,
  bodyMeasurement: ((repos, userId, clientId) =>
    repos.bodyMeasurements.findByClientId(userId, clientId)) satisfies ReplayFinder,
};
