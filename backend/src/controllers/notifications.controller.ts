/** Device registration for web push. */
import type { RequestHandler } from 'express';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { registerDevice } from '../services/notifications/notifications.service.js';

export function makeNotificationsController() {
  const subscribe: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { oneSignalPlayerId } = req.body as { oneSignalPlayerId: string };
        await registerDevice(currentRepos(req), currentUser(req).id, oneSignalPlayerId);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  };

  return { subscribe };
}
