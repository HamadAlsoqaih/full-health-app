/**
 * Nutrition endpoints: search, daily log, and the synchronous photo scan.
 */
import type { RequestHandler } from 'express';
import type { FoodLogInput } from '@app/shared-types';
import type { AppDeps } from '../ports.js';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { badRequest } from '../errors.js';
import {
  deleteLogEntry,
  getDailyLog,
  logFood,
  searchFoods,
} from '../services/nutrition/nutrition.service.js';
import { analysePhoto } from '../services/ai/vision/photo-analysis.service.js';
import type { VisionQuota } from '../middlewares/rate-limit.middleware.js';

export function makeNutritionController(deps: AppDeps, quota: VisionQuota) {
  const search: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { q } = req.query as { q: string };
        res.json(await searchFoods(currentRepos(req), deps.foodDatabases, currentUser(req).id, q));
      } catch (error) {
        next(error);
      }
    })();
  };

  const log: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const input = req.body as FoodLogInput;
        const { row, replayed } = await logFood(
          currentRepos(req),
          deps.foodDatabases,
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

  const dailyLog: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { date } = req.query as { date: string };
        res.json(await getDailyLog(currentRepos(req), currentUser(req).id, date));
      } catch (error) {
        next(error);
      }
    })();
  };

  const removeEntry: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { id } = req.params as { id: string };
        await deleteLogEntry(currentRepos(req), currentUser(req).id, id);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  };

  /**
   * Synchronous (spec rule 2): the client shows a spinner and waits.
   *
   * Returns the estimate WITHOUT writing a food-log row. The user confirms or
   * adjusts it first (spec rule 3), and the confirmation goes through
   * POST /nutrition/log like any other food.
   */
  const scanPhoto: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const file = req.file;
        if (!file) throw badRequest('Attach an image under the field name "photo".');

        const result = await analysePhoto(
          { repos: currentRepos(req), ai: deps.ai, quota },
          currentUser(req).id,
          file.buffer,
          file.mimetype,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    })();
  };

  return { search, log, dailyLog, removeEntry, scanPhoto };
}
