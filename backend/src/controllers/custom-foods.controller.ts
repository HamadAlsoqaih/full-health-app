/** The user's own foods. Offline-syncable, hence the 200-on-replay contract. */
import type { RequestHandler } from 'express';
import type { CustomFoodInput } from '@app/shared-types';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { createCustomFood, listCustomFoods } from '../services/nutrition/custom-foods.service.js';

export function makeCustomFoodsController() {
  const list: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(await listCustomFoods(currentRepos(req), currentUser(req).id));
      } catch (error) {
        next(error);
      }
    })();
  };

  const create: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const input = req.body as CustomFoodInput;
        const { row, replayed } = await createCustomFood(
          currentRepos(req),
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

  return { list, create };
}
