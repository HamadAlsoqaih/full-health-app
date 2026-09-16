/** Exercise library and routine endpoints. */
import type { RequestHandler } from 'express';
import type { RoutineInput } from '@app/shared-types';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { listExercises } from '../services/exercises/exercises.service.js';
import {
  createRoutine,
  deleteRoutine,
  listRoutines,
  updateRoutine,
} from '../services/routines/routines.service.js';

export function makeTrainingController() {
  const exercises: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { muscleGroup, q } = req.query as { muscleGroup?: string; q?: string };
        res.json(
          await listExercises(currentRepos(req), {
            ...(muscleGroup ? { muscleGroup } : {}),
            ...(q ? { q } : {}),
          }),
        );
      } catch (error) {
        next(error);
      }
    })();
  };

  const routines: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(await listRoutines(currentRepos(req), currentUser(req).id));
      } catch (error) {
        next(error);
      }
    })();
  };

  const create: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const input = req.body as RoutineInput;
        res.status(201).json(await createRoutine(currentRepos(req), currentUser(req).id, input));
      } catch (error) {
        next(error);
      }
    })();
  };

  const update: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { id } = req.params as { id: string };
        const patch = req.body as Partial<RoutineInput>;
        res.json(await updateRoutine(currentRepos(req), currentUser(req).id, id, patch));
      } catch (error) {
        next(error);
      }
    })();
  };

  const remove: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { id } = req.params as { id: string };
        await deleteRoutine(currentRepos(req), currentUser(req).id, id);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  };

  return { exercises, routines, create, update, remove };
}
