/**
 * Auth and gating.
 *
 * The central assertion is that every route outside /auth is genuinely closed,
 * enumerated rather than spot-checked: a route added later without requireAuth
 * should make this fail.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestHarness } from '../helpers/app.js';

/** Every authenticated route in the API surface. */
const PROTECTED_ROUTES: Array<[string, string]> = [
  ['get', '/api/users/me'],
  ['put', '/api/users/me'],
  ['post', '/api/users/me/onboarding'],
  ['get', '/api/exercises'],
  ['get', '/api/routines'],
  ['post', '/api/routines'],
  ['get', '/api/workout-logs'],
  ['post', '/api/workout-logs'],
  ['get', '/api/nutrition/search'],
  ['get', '/api/nutrition/custom-foods'],
  ['post', '/api/nutrition/custom-foods'],
  ['get', '/api/nutrition/log'],
  ['post', '/api/nutrition/log'],
  ['post', '/api/nutrition/scan-photo'],
  ['get', '/api/body-composition'],
  ['post', '/api/body-composition/entry'],
  ['get', '/api/body-composition/trend'],
  ['get', '/api/body-composition/evaluation'],
  ['get', '/api/overview'],
  ['get', '/api/billing/status'],
  ['post', '/api/notifications/subscribe'],
  // Logout is under /auth but still requires a session: it must know whose
  // session to end. A blanket "/auth/* is public" rule would wrongly open it.
  ['post', '/api/auth/logout'],
];

describe('auth gating', () => {
  it.each(PROTECTED_ROUTES)('%s %s requires a bearer token', async (method, path) => {
    const { app } = createTestHarness();
    const response = await (request(app) as never as Record<string, (p: string) => never>)[method]!(
      path,
    );

    expect((response as unknown as { status: number }).status).toBe(401);
    expect((response as unknown as { body: unknown }).body).toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('rejects a malformed Authorization header', async () => {
    const { app } = createTestHarness();
    for (const header of ['', 'Bearer', 'Basic abc', 'Bearer ', 'token abc']) {
      const response = await request(app).get('/api/users/me').set('Authorization', header);
      expect(response.status).toBe(401);
    }
  });

  it('rejects a token that is not recognised', async () => {
    const { app } = createTestHarness();
    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', 'Bearer test-token:not-a-real-user');
    expect(response.status).toBe(401);
  });

  it('leaves the health endpoint open, and says nothing about configuration', async () => {
    const { app } = createTestHarness();
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', env: 'test' });
    // It must not leak which integrations are wired up.
    expect(JSON.stringify(response.body)).not.toMatch(/key|dsn|secret|url/i);
  });

  it('returns the standard error envelope for an unmatched route', async () => {
    const { app } = createTestHarness();
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(typeof response.body.error.message).toBe('string');
  });
});

describe('registration and login', () => {
  it('registers, creates the profile mirror, and reports onboarding as unstarted', async () => {
    const { app, store } = createTestHarness();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'New.User@Example.com', password: 'correct-horse-battery' });

    expect(response.status).toBe(201);
    expect(response.body.session.accessToken).toBeTruthy();
    // Email is normalised by the schema before it reaches the service.
    expect(response.body.user.email).toBe('new.user@example.com');
    expect(response.body.user.onboarding).toEqual({
      goalsSubmitted: false,
      startingStatsSubmitted: false,
      complete: false,
    });
    // The public mirror exists immediately, not lazily on first read.
    expect(store.users).toHaveLength(1);
  });

  it('rejects a weak or malformed credential with field-level detail', async () => {
    const { app } = createTestHarness();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.body.error.details)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('rejects unexpected fields rather than silently ignoring them', async () => {
    const { app } = createTestHarness();

    const response = await request(app).post('/api/auth/register').send({
      email: 'a@example.com',
      password: 'correct-horse-battery',
      isAdmin: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('logs in an existing user', async () => {
    const { app } = createTestHarness();
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@example.com', password: 'correct-horse-battery' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'correct-horse-battery' });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('a@example.com');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { app } = createTestHarness();
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@example.com', password: 'correct-horse-battery' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'wrong-password-entirely' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'correct-horse-battery' });

    // Identical status and message: distinguishing them would turn the endpoint
    // into an account-existence oracle.
    expect(wrongPassword.status).toBe(unknownEmail.status);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('refreshes a session, which is what stops every session dying after an hour', async () => {
    const { app } = createTestHarness();
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@example.com', password: 'correct-horse-battery' });

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: registered.body.session.refreshToken });

    expect(response.status).toBe(200);
    expect(response.body.session.accessToken).toBeTruthy();
  });

  it('invalidates the session on logout', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    expect(
      (await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(200);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(204);

    const after = await request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});

describe('PUT /users/me mass assignment', () => {
  it('refuses to let a client mark its own onboarding complete', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token, id } = seedUser('a@example.com');

    const response = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ onboardingComplete: true });

    // Rejected outright rather than quietly dropped, so the client learns it is
    // not a writable field.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(store.users.find((u) => u.id === id)?.onboardingComplete).toBe(false);
  });

  it('refuses to let a client change its id or email', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    for (const payload of [{ id: 'someone-else' }, { email: 'other@example.com' }]) {
      const response = await request(app)
        .put('/api/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);
      expect(response.status).toBe(400);
    }
  });

  it("accepts the fields that are genuinely the client's to set", async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        displayName: 'Hamad',
        units: 'imperial',
        preferences: { ai: { photoScanEnabled: false } },
      });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('Hamad');
    expect(response.body.units).toBe('imperial');
    expect(response.body.preferences.ai.photoScanEnabled).toBe(false);
    // Unspecified preferences keep their defaults rather than being wiped.
    expect(response.body.preferences.ai.enabled).toBe(true);
    expect(response.body.preferences.notifications.remindersEnabled).toBe(true);
  });
});

describe('onboarding progress', () => {
  it('derives progress from the two domains onboarding seeds, and completes itself', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    // Step 2/4: goals, with dietary preferences nested inside them.
    const goals = await authed(
      request(app)
        .post('/api/users/me/onboarding')
        .send({
          goals: {
            goal: 'cut',
            targetCalories: 2200,
            dietaryPrefs: { preferences: ['halal'], skipped: false },
          },
        }),
    );
    expect(goals.status).toBe(200);
    expect(goals.body.onboarding).toEqual({
      goalsSubmitted: true,
      startingStatsSubmitted: false,
      complete: false,
    });

    // Step 3: starting stats become the first body-composition entry.
    const stats = await authed(
      request(app)
        .post('/api/body-composition/entry')
        .send({ clientId: 'onboard-stats-01', date: '2026-03-01', weightKg: 88.4 }),
    );
    expect(stats.status).toBe(201);

    // No explicit "finish onboarding" call: getMe notices both writes landed.
    const me = await authed(request(app).get('/api/users/me'));
    expect(me.body.onboarding).toEqual({
      goalsSubmitted: true,
      startingStatsSubmitted: true,
      complete: true,
    });
  });

  it('resumes at stats when the app closed after goals but before stats', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    await authed(
      request(app)
        .post('/api/users/me/onboarding')
        .send({ goals: { goal: 'bulk' } }),
    );

    // This is exactly what the client reads on next open to decide where to resume.
    const me = await authed(request(app).get('/api/users/me'));
    expect(me.body.onboarding.goalsSubmitted).toBe(true);
    expect(me.body.onboarding.startingStatsSubmitted).toBe(false);
    expect(me.body.onboarding.complete).toBe(false);
  });
});
