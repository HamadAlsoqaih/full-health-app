/**
 * Authentication, and the construction of the per-request database handle.
 *
 * This is where the row-level-security decision lives. The spec mandates RLS on
 * every user-owned table AND gives the backend a service-role key — but the
 * service-role key bypasses RLS entirely, which would make every policy decorative
 * for API traffic.
 *
 * Resolution: the request's own JWT is forwarded to Supabase alongside the ANON key,
 * so `auth.uid()` resolves to the caller and the policies actually apply. The
 * service-role key is confined to config/supabaseAdmin.ts and the few operations
 * that have no user JWT at all.
 *
 * The consequence is structural: because the handle is per request, repositories
 * must be built per request too, which is why AppDeps.repositories is a factory.
 */
import type { RequestHandler } from 'express';
import { unauthenticated } from '../errors.js';
import type { AppDeps, AuthenticatedUser } from '../ports.js';
import type { Repositories } from '../repositories/index.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      /** The caller's bearer token, needed to build an RLS-scoped database handle. */
      accessToken?: string;
      /** Repositories scoped to this request, and therefore to this user. */
      repos?: Repositories;
    }
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
}

/**
 * Requires a valid session. Mounted per router rather than globally with a path
 * exception: `/auth/logout` needs `req.user`, so a blanket "skip everything under
 * /auth" rule would leave it unauthenticated.
 */
export function requireAuth(deps: AppDeps): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      try {
        const token = bearerToken(req.headers.authorization);
        if (!token) {
          next(unauthenticated('A bearer token is required.'));
          return;
        }

        const user = await deps.auth.getUserFromToken(token);
        if (!user) {
          next(unauthenticated('Session is invalid or has expired.'));
          return;
        }

        req.user = user;
        req.accessToken = token;
        req.repos = deps.repositories({
          db: { accessToken: token },
          clock: deps.clock,
          uuid: deps.uuid,
        });
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

/**
 * Builds unauthenticated repositories for the few public endpoints that still need
 * database access (registration writing the public user mirror).
 */
export function attachAnonymousRepos(deps: AppDeps): RequestHandler {
  return (req, _res, next) => {
    req.repos = deps.repositories({ db: {}, clock: deps.clock, uuid: deps.uuid });
    next();
  };
}

/** Narrows `req.user` for handlers mounted behind requireAuth. */
export function currentUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
  if (!req.user) {
    // Reaching here means a route was mounted without requireAuth — a wiring bug.
    throw unauthenticated('Authentication required.');
  }
  return req.user;
}

export function currentRepos(req: { repos?: Repositories }): Repositories {
  if (!req.repos) throw new Error('Repositories were not attached to this request.');
  return req.repos;
}
