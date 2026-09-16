/** Profile and onboarding endpoints. */
import type { RequestHandler } from 'express';
import type { Goals, UserUpdateInput } from '@app/shared-types';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { getMe, submitOnboarding, updateMe } from '../services/users/users.service.js';

export function makeUsersController() {
  const me: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(await getMe(currentRepos(req), currentUser(req).id));
      } catch (error) {
        next(error);
      }
    })();
  };

  const update: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const input = req.body as UserUpdateInput;
        res.json(await updateMe(currentRepos(req), currentUser(req).id, input));
      } catch (error) {
        next(error);
      }
    })();
  };

  /**
   * Records the onboarding goals answers. Dietary preferences arrive nested inside
   * `goals`, because onboarding step 4 has no endpoint of its own.
   */
  const onboarding: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { goals } = req.body as { goals: Goals };
        res.json(await submitOnboarding(currentRepos(req), currentUser(req).id, goals));
      } catch (error) {
        next(error);
      }
    })();
  };

  return { me, update, onboarding };
}
