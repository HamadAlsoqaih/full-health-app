/**
 * In-memory AuthPort.
 *
 * Tokens are the literal string `test-token:<userId>`, which is what makes every
 * authenticated integration test a one-liner:
 *
 *     .set('Authorization', `Bearer test-token:${userId}`)
 *
 * The middleware depends on AuthPort, never on Supabase directly, so nothing in the
 * request path needs mocking beyond this.
 */
import type { AuthPort, AuthTokens, AuthenticatedUser } from '../../src/ports.js';
import { unauthenticated } from '../../src/errors.js';

export interface FakeAuth extends AuthPort {
  /** Registers a user without going through the HTTP layer, for fixtures. */
  seedUser(email: string, password?: string): AuthenticatedUser;
  tokenFor(userId: string): string;
  /** Marks a token as no longer valid, so expiry and refresh can be tested. */
  invalidate(token: string): void;
}

export function createFakeAuth(uuid: () => string): FakeAuth {
  const users = new Map<string, { user: AuthenticatedUser; password: string }>();
  const revoked = new Set<string>();

  const tokenFor = (userId: string) => `test-token:${userId}`;

  const tokens = (userId: string): AuthTokens => ({
    accessToken: tokenFor(userId),
    refreshToken: `test-refresh:${userId}`,
    expiresIn: 3600,
    expiresAt: 4_000_000_000,
  });

  const seedUser = (email: string, password = 'correct-horse-battery') => {
    const existing = [...users.values()].find((u) => u.user.email === email);
    if (existing) return existing.user;
    const user: AuthenticatedUser = { id: uuid(), email };
    users.set(user.id, { user, password });
    return user;
  };

  return {
    seedUser,
    tokenFor,
    invalidate(token) {
      revoked.add(token);
    },

    async register(email, password) {
      if ([...users.values()].some((u) => u.user.email === email)) {
        throw unauthenticated('An account with that email already exists.');
      }
      const user = seedUser(email, password);
      return { user, tokens: tokens(user.id) };
    },

    async login(email, password) {
      const entry = [...users.values()].find((u) => u.user.email === email);
      if (!entry || entry.password !== password) {
        throw unauthenticated('Email or password is incorrect.');
      }
      return { user: entry.user, tokens: tokens(entry.user.id) };
    },

    async logout(accessToken) {
      revoked.add(accessToken);
    },

    async refresh(refreshToken) {
      const userId = refreshToken.startsWith('test-refresh:')
        ? refreshToken.slice('test-refresh:'.length)
        : null;
      const entry = userId ? users.get(userId) : undefined;
      if (!entry) throw unauthenticated('Refresh token is not valid.');
      revoked.delete(tokenFor(entry.user.id));
      return { user: entry.user, tokens: tokens(entry.user.id) };
    },

    async getUserFromToken(accessToken) {
      if (revoked.has(accessToken)) return null;
      if (!accessToken.startsWith('test-token:')) return null;
      const userId = accessToken.slice('test-token:'.length);
      return users.get(userId)?.user ?? null;
    },
  };
}
