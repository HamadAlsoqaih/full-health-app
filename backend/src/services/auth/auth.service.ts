/**
 * Supabase Auth wrapper.
 *
 * Implements AuthPort, so nothing else in the request path depends on Supabase
 * directly — which is what lets the middleware, the controllers and every
 * integration test run against an in-memory fake.
 *
 * `getUserFromToken` is on the hot path for every authenticated request. It calls
 * Supabase to validate, which is a network round trip; a future optimisation is
 * local JWT verification against the project's JWKS, noted in
 * docs/REMAINING-WORK.md rather than half-built here.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config/index.js';
import { conflict, unauthenticated } from '../../errors.js';
import { logger } from '../../logger.js';
import type { AuthPort, AuthTokens, AuthenticatedUser } from '../../ports.js';

interface SupabaseSessionLike {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
}

function toTokens(session: SupabaseSessionLike): AuthTokens {
  const expiresIn = session.expires_in ?? 3600;
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn,
    expiresAt: session.expires_at ?? Math.floor(Date.now() / 1000) + expiresIn,
  };
}

export function createSupabaseAuth(): AuthPort {
  // Built from the ANON key: this client performs auth operations on behalf of an
  // end user and must not carry service-role privileges.
  let client: SupabaseClient | null = null;
  const getClient = (): SupabaseClient => {
    if (client) return client;
    const { url, anonKey } = config.supabase.require();
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client;
  };

  return {
    async register(email, password) {
      const { data, error } = await getClient().auth.signUp({ email, password });

      if (error) {
        // Supabase reports an existing account through this path; surfaced as a
        // conflict rather than a generic failure so the client can offer to log in.
        if (/already registered|already exists/i.test(error.message)) {
          throw conflict('An account with that email already exists.');
        }
        logger.warn({ err: error }, 'sign-up failed');
        throw unauthenticated(error.message);
      }

      if (!data.user || !data.session) {
        // Happens when the project requires email confirmation. Worth its own
        // message: the caller did nothing wrong and there is nothing to retry.
        throw unauthenticated('Account created. Confirm your email address, then log in.');
      }

      return {
        user: { id: data.user.id, email: data.user.email ?? email },
        tokens: toTokens(data.session as SupabaseSessionLike),
      };
    },

    async login(email, password) {
      const { data, error } = await getClient().auth.signInWithPassword({ email, password });
      if (error || !data.user || !data.session) {
        // Deliberately does not distinguish an unknown email from a wrong password:
        // doing so turns the endpoint into an account-existence oracle.
        throw unauthenticated('Email or password is incorrect.');
      }
      return {
        user: { id: data.user.id, email: data.user.email ?? email },
        tokens: toTokens(data.session as SupabaseSessionLike),
      };
    },

    async logout(accessToken) {
      const { url, anonKey } = config.supabase.require();
      // Scoped to the caller's own session, so one device signing out does not end
      // the others.
      const scoped = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await scoped.auth.signOut();
      if (error) logger.warn({ err: error }, 'sign-out reported an error');
    },

    async refresh(refreshToken) {
      const { data, error } = await getClient().auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error || !data.user || !data.session) {
        throw unauthenticated('Your session has expired. Log in again.');
      }
      return {
        user: { id: data.user.id, email: data.user.email ?? '' },
        tokens: toTokens(data.session as SupabaseSessionLike),
      };
    },

    async getUserFromToken(accessToken): Promise<AuthenticatedUser | null> {
      const { data, error } = await getClient().auth.getUser(accessToken);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? '' };
    },
  };
}
