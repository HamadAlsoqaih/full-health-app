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
import { analysePhoto, refinePhotoEstimate } from '../services/ai/vision/photo-analysis.service.js';
import { photoRefineSchema } from '../validation/index.js';
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

  /**
   * Second pass over the same photo, with the follow-up questions answered.
   *
   * The image is re-uploaded rather than held between requests. That keeps the
   * "never persisted" guarantee exactly as it is: the browser already has the
   * file, and the server sees it for the length of one request and writes it
   * nowhere.
   *
   * The answers ride as a JSON field inside the multipart body, since the photo
   * makes this a multipart request either way.
   */
  const refineScan: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const file = req.file;
        if (!file) throw badRequest('Attach the same image under the field name "photo".');

        const raw = (req.body as { answers?: unknown }).answers;
        if (typeof raw !== 'string') {
          throw badRequest('Send the answers as a JSON string in the "answers" field.');
        }

        let decoded: unknown;
        try {
          decoded = JSON.parse(raw);
        } catch {
          throw badRequest('The "answers" field is not valid JSON.');
        }

        const parsed = photoRefineSchema.safeParse(decoded);
        if (!parsed.success) {
          throw badRequest('The answers were not in the expected shape.');
        }

        const result = await refinePhotoEstimate(
          { repos: currentRepos(req), ai: deps.ai, quota },
          currentUser(req).id,
          file.buffer,
          file.mimetype,
          parsed.data,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    })();
  };

  return { search, log, dailyLog, removeEntry, scanPhoto, refineScan };
}
