/**
 * The auth endpoints must talk to the database AS the user they just signed in.
 *
 * This is the regression test for the bug that made registration and login fail
 * outright against a real Supabase project, while 178 tests passed.
 *
 * What happened: /auth/register, /auth/login and /auth/refresh are
 * unauthenticated routes, so a middleware attached repositories built from an
 * empty handle — no JWT. The handlers then authenticated the user and
 * immediately wrote the profile mirror and read it back through those anonymous
 * repositories. In Postgres `auth.uid()` was therefore NULL, the
 * `users_insert_own` policy (`with check (auth.uid() = id)`) rejected the
 * insert, and every signup and login returned 500 with code 42501.
 *
 * Why nothing caught it: the in-memory fakes have no concept of row-level
 * security. They answer any query put to them regardless of who is asking, so a
 * repository with no identity behaves exactly like one with the right identity.
 * Every assertion about behaviour passed; the thing that was broken was *which
 * credentials the call was made with*, which no behavioural assertion can see.
 *
 * So this file asserts on the seam itself rather than on behaviour: it wraps the
 * repository factory and inspects the handle each request builds. That is
 * testable without Postgres, and it is the only property that was actually
 * wrong.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { AppDeps } from '../../src/ports.js';
import type { RepositoryContext } from '../../src/repositories/index.js';
import { createTestHarness } from '../helpers/app.js';

/** The fake auth port's default password for a seeded user. */
const SEEDED_PASSWORD = 'correct-horse-battery';

interface Observed {
  contexts: RepositoryContext[];
  app: ReturnType<typeof createApp>;
  auth: ReturnType<typeof createTestHarness>['auth'];
}

/**
 * An app whose repository factory records the context it was called with.
 *
 * Built from the harness's own deps so everything else — fakes, clock, ids — is
 * identical to the other integration tests.
 */
function observedApp(): Observed {
  const harness = createTestHarness();
  const contexts: RepositoryContext[] = [];

  const deps: AppDeps = {
    ...harness.deps,
    repositories: (ctx) => {
      contexts.push(ctx);
      return harness.deps.repositories(ctx);
    },
  };

  return { contexts, app: createApp(deps), auth: harness.auth };
}

/** The access tokens every repository set built during the request was scoped to. */
const tokensUsed = (contexts: RepositoryContext[]): Array<string | undefined> =>
  contexts.map((ctx) => (ctx.db as { accessToken?: string }).accessToken);

describe('POST /auth/register', () => {
  it('builds its repositories from the token it just issued', async () => {
    const { contexts, app } = observedApp();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'correct-horse' });

    expect(response.status).toBe(201);

    const issued = response.body.session.accessToken as string;
    expect(issued).toMatch(/\S/);

    // The point of the test: at least one repository set was built, and every
    // one of them carried the caller's own token. Previously this array was
    // [undefined] and Postgres rejected the write.
    const tokens = tokensUsed(contexts);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((token) => token === issued)).toBe(true);
  });

  it('never builds a repository with no identity at all', async () => {
    const { contexts, app } = observedApp();

    await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@example.com', password: 'correct-horse' });

    // An anonymous handle cannot legally read or write a single user-owned row,
    // so constructing one on this path is the bug, whether or not it is used.
    expect(tokensUsed(contexts)).not.toContain(undefined);
  });
});

describe('POST /auth/login', () => {
  it('builds its repositories from the token it just issued', async () => {
    const { contexts, app, auth } = observedApp();
    const seeded = auth.seedUser('existing@example.com');

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: seeded.email, password: SEEDED_PASSWORD });

    expect(response.status).toBe(200);

    const issued = response.body.session.accessToken as string;
    expect(tokensUsed(contexts).every((token) => token === issued)).toBe(true);
  });
});

describe('POST /auth/refresh', () => {
  it('builds its repositories from the refreshed token, not the expired one', async () => {
    const { contexts, app, auth } = observedApp();
    const seeded = auth.seedUser('existing@example.com');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: seeded.email, password: SEEDED_PASSWORD });
    const firstToken = login.body.session.accessToken as string;

    contexts.length = 0;

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login.body.session.refreshToken });

    expect(refreshed.status).toBe(200);

    const newToken = refreshed.body.session.accessToken as string;
    const tokens = tokensUsed(contexts);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((token) => token === newToken)).toBe(true);

    // Not asserted: that the new token DIFFERS from the pre-refresh one. The
    // fake issues a deterministic `test-token:<userId>`, so the two strings are
    // equal here and such an assertion would be testing the fake rather than
    // the app. Real Supabase mints a new JWT, and the assertion above — every
    // client scoped to whatever refresh returned — is the property that matters
    // either way.
    expect(firstToken).toMatch(/\S/);
  });
});

describe('a failed auth attempt', () => {
  it('touches no repository at all', async () => {
    const { contexts, app } = observedApp();

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-but-long-enough' });

    expect(response.status).toBe(401);
    // Nothing was authenticated, so there is no identity to act as and no
    // reason to have built a client.
    expect(contexts).toHaveLength(0);
  });
});
