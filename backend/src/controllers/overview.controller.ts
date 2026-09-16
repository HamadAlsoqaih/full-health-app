/** The Overview tab's single aggregating endpoint (spec rule 5). */
import type { RequestHandler } from 'express';
import type { AppDeps } from '../ports.js';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { getOverview } from '../services/overview/overview.service.js';

export function makeOverviewController(deps: AppDeps) {
  const summary: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        res.json(
          await getOverview(
            {
              repos: currentRepos(req),
              ai: deps.ai,
              notifications: deps.notifications,
              clock: deps.clock,
            },
            currentUser(req).id,
          ),
        );
      } catch (error) {
        next(error);
      }
    })();
  };

  return { summary };
}
