/**
 * Auth endpoints.
 *
 * Registration and login both call ensureUserRow, so the public profile mirror
 * exists before any other endpoint needs it.
 */
import type { RequestHandler } from 'express';
import type { AuthResult, AuthSession } from '@app/shared-types';
import type { AppDeps } from '../ports.js';
import { currentRepos, currentUser } from '../middlewares/auth.middleware.js';
import { ensureUserRow, getMe } from '../services/users/users.service.js';
import { unauthenticated } from '../errors.js';

const toSession = (tokens: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}): AuthSession => ({
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  expiresIn: tokens.expiresIn,
  expiresAt: tokens.expiresAt,
});

export function makeAuthController(deps: AppDeps) {
  const register: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { email, password } = req.body as { email: string; password: string };
        const { user, tokens } = await deps.auth.register(email, password);

        const repos = currentRepos(req);
        await ensureUserRow(repos, user.id, user.email);

        const body: AuthResult = {
          user: await getMe(repos, user.id),
          session: toSession(tokens),
        };
        res.status(201).json(body);
      } catch (error) {
        next(error);
      }
    })();
  };

  const login: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { email, password } = req.body as { email: string; password: string };
        const { user, tokens } = await deps.auth.login(email, password);

        const repos = currentRepos(req);
        await ensureUserRow(repos, user.id, user.email);

        const body: AuthResult = {
          user: await getMe(repos, user.id),
          session: toSession(tokens),
        };
        res.status(200).json(body);
      } catch (error) {
        next(error);
      }
    })();
  };

  /**
   * Without this endpoint every session would silently die after about an hour:
   * the frontend holds the tokens itself, so supabase-js's own auto-refresh never
   * runs. Paired with a single retry-on-401 in the client's apiClient.
   */
  const refresh: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        const { refreshToken } = req.body as { refreshToken: string };
        const { user, tokens } = await deps.auth.refresh(refreshToken);
        const repos = currentRepos(req);
        await ensureUserRow(repos, user.id, user.email);
        const body: AuthResult = {
          user: await getMe(repos, user.id),
          session: toSession(tokens),
        };
        res.status(200).json(body);
      } catch (error) {
        next(error);
      }
    })();
  };

  const logout: RequestHandler = (req, res, next) => {
    void (async () => {
      try {
        // Behind requireAuth, so req.accessToken is present; guarded anyway rather
        // than asserted, since a wiring mistake should not be a 500.
        const token = req.accessToken;
        if (!token) throw unauthenticated('A bearer token is required.');
        currentUser(req);
        await deps.auth.logout(token);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    })();
  };

  return { register, login, refresh, logout };
}
