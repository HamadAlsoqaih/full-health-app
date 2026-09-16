/**
 * Workout log endpoints. Offline-syncable.
 *
 * The status code carries the idempotency contract: 201 for a new row, 200 for a
 * replay of one already stored. The client's outbox treats both as success and
 * drops the queued item; a 409 would make it retry forever.
 */
import type { RequestHandler } from 'express';
import type { WorkoutLogInput } from '@app/shared-types';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { listWorkoutLogs, logWorkout } from '../services/workout-logs/workout-logs.service.js';

export function makeWorkoutLogsController() {
  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(await listWorkoutLogs(currentRepos(req), currentUser(req).id));
      } catch (error) {
        next(error);
      }
    })();
  };

  const create: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const input = req.body as WorkoutLogInput;
        const { row, replayed } = await logWorkout(currentRepos(req), currentUser(req).id, input);
        if (replayed) res.setHeader('Idempotent-Replay', 'true');
        res.status(replayed ? 200 : 201).json(row);
      } catch (error) {
        next(error);
      }
    })();
  };

  return { list, create };
}
