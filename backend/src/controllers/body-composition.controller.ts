/** Body-composition endpoints: entries, the deterministic trend, and the evaluation. */
import type { RequestHandler } from 'express';
import type { BodyMeasurementInput } from '@app/shared-types';
import type { AppDeps } from '../ports.js';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import {
  getEvaluation,
  getTrend,
  listMeasurements,
  recordMeasurement,
} from '../services/body-composition/body-composition.service.js';

export function makeBodyCompositionController(deps: AppDeps) {
  const bodyCompDeps = (req: Parameters<RequestHandler>[0]) => ({
    repos: currentRepos(req),
    ai: deps.ai,
    notifications: deps.notifications,
    clock: deps.clock,
  });

  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(await listMeasurements(currentRepos(req), currentUser(req).id));
      } catch (error) {
        next(error);
      }
    })();
  };

  const create: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const input = req.body as BodyMeasurementInput;
        const { row, replayed } = await recordMeasurement(
          bodyCompDeps(req),
          currentUser(req).id,
          input,
        );
        if (replayed) res.setHeader('Idempotent-Replay', 'true');
        res.status(replayed ? 200 : 201).json(row);
      } catch (error) {
        next(error);
      }
    })();
  };

  /** Deterministic arithmetic only — never AI (spec rule 4). */
  const trend: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { days } = req.query as unknown as { days: number };
        res.json(await getTrend(bodyCompDeps(req), currentUser(req).id, days));
      } catch (error) {
        next(error);
      }
    })();
  };

  /** Also the reaper: a stale pending evaluation is re-fired on read. */
  const evaluation: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(await getEvaluation(bodyCompDeps(req), currentUser(req).id));
      } catch (error) {
        next(error);
      }
    })();
  };

  return { list, create, trend, evaluation };
}
