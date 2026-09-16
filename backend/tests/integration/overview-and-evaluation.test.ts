/**
 * Overview aggregation, and the AI evaluation lifecycle including the reaper.
 *
 * The evaluation tests are the ones that matter most here: the no-queue design
 * only works if a row can never sit pending forever and the notification can
 * never double-send, and neither property is visible from reading the code alone.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AiProvider, PhotoEstimate } from '../../src/ports.js';
import { createTestHarness, type TestHarness } from '../helpers/app.js';

/**
 * Seeds enough history that the trend engine returns a usable result.
 *
 * The window ends the day BEFORE the harness clock's "today", so a test asserting
 * on today's calorie total is not also counting seeded history.
 */
function seedHistory(harness: TestHarness, userId: string, days = 30): void {
  const dayBeforeToday = Date.UTC(2026, 1, 28);
  for (let i = days; i >= 1; i -= 1) {
    const date = new Date(dayBeforeToday - (i - 1) * 86_400_000).toISOString().slice(0, 10);
    harness.store.bodyMeasurements.push({
      id: `bm-${i}`,
      userId,
      clientId: `bm-seed-${i}`,
      date,
      weightKg: 90 - (days - i) * 0.07,
      createdAt: `${date}T08:00:00.000Z`,
    });
    harness.store.foodLog.push({
      id: `fl-${i}`,
      userId,
      clientId: `fl-seed-${i}`,
      date,
      foodItemId: 'manual:',
      foodName: 'Seed meal',
      source: 'manual',
      servingLabel: '1 serving',
      servingMultiplier: 1,
      baseCalories: 2100,
      baseProteinG: 160,
      baseCarbsG: 210,
      baseFatG: 65,
      calories: 2100,
      proteinG: 160,
      carbsG: 210,
      fatG: 65,
      loggedAt: `${date}T20:00:00.000Z`,
    });
  }
}

/** An AI provider that never answers, to simulate a process dying mid-call. */
function hangingAi(): AiProvider {
  return {
    name: 'stub',
    supportsVision: true,
    async estimateFromPhoto(): Promise<PhotoEstimate> {
      throw new Error('not used');
    },
    phraseTrend() {
      return new Promise<string>(() => {
        /* never resolves */
      });
    },
  };
}

/** An AI provider that always fails, to drive the failure path. */
function failingAi(): AiProvider {
  return {
    name: 'stub',
    supportsVision: true,
    async estimateFromPhoto(): Promise<PhotoEstimate> {
      throw new Error('not used');
    },
    async phraseTrend(): Promise<string> {
      throw new Error('provider exploded');
    },
  };
}

describe('GET /overview', () => {
  it('aggregates everything the dashboard needs in one response', async () => {
    const harness = createTestHarness();
    const { app, seedUser, store } = harness;
    const { token, id } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    seedHistory(harness, id);
    store.users[0]!.goals = { goal: 'cut', targetCalories: 2000, targetProteinG: 150 };

    const exerciseId = '11111111-1111-4111-8111-111111111111';
    store.exercises.push({
      id: exerciseId,
      externalId: 'Squat',
      name: 'Squat',
      muscleGroup: 'quadriceps',
      secondaryMuscles: [],
      category: 'strength',
      level: 'beginner',
      instructions: [],
    });
    await authed(
      request(app)
        .post('/api/routines')
        .send({
          name: 'Leg Day',
          exercises: [{ exerciseId, exerciseName: 'Squat', sets: 5, targetReps: 5 }],
        }),
    );

    // Today's food, so the calorie panel has something to total.
    const food = await authed(
      request(app).post('/api/nutrition/custom-foods').send({
        clientId: 'cf-client-000001',
        name: 'Chicken and rice',
        calories: 600,
        proteinG: 50,
        carbsG: 60,
        fatG: 15,
      }),
    );
    await authed(
      request(app)
        .post('/api/nutrition/log')
        .send({
          clientId: 'fl-client-000001',
          foodItemId: `custom:${food.body.id}`,
          date: '2026-03-01',
          servingMultiplier: 2,
        }),
    );

    const response = await authed(request(app).get('/api/overview'));

    expect(response.status).toBe(200);
    expect(response.body.date).toBe('2026-03-01');
    // 600 x 2
    expect(response.body.calories.logged).toBe(1200);
    expect(response.body.calories.target).toBe(2000);
    expect(response.body.calories.remaining).toBe(800);
    expect(response.body.macros.proteinG).toBe(100);
    expect(response.body.macros.proteinTargetG).toBe(150);
    expect(response.body.nextRoutine).toMatchObject({ name: 'Leg Day', exerciseCount: 1 });
    expect(response.body.bodyComposition.latestWeightKg).toBeCloseTo(87.97, 1);
    expect(response.body.bodyComposition.direction).toBe('losing');
    expect(response.body.evaluation.status).toBeDefined();
  });

  it('lets remaining calories go negative, so being over target is visible', async () => {
    const harness = createTestHarness();
    const { app, seedUser, store } = harness;
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    store.users[0]!.goals = { goal: 'cut', targetCalories: 500 };

    const food = await authed(
      request(app).post('/api/nutrition/custom-foods').send({
        clientId: 'cf-client-000001',
        name: 'Large pizza',
        calories: 2400,
        proteinG: 90,
        carbsG: 260,
        fatG: 100,
      }),
    );
    await authed(
      request(app)
        .post('/api/nutrition/log')
        .send({
          clientId: 'fl-client-000001',
          foodItemId: `custom:${food.body.id}`,
          date: '2026-03-01',
          servingMultiplier: 1,
        }),
    );

    const response = await authed(request(app).get('/api/overview'));
    expect(response.body.calories.remaining).toBe(-1900);
  });

  it('returns a usable shape for a brand new user with no data', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .get('/api/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.calories.logged).toBe(0);
    expect(response.body.calories.target).toBeUndefined();
    expect(response.body.nextRoutine).toBeUndefined();
    expect(response.body.bodyComposition).toBeUndefined();
    expect(response.body.evaluation.status).toBe('none');
  });

  it("does not show one user's data to another", async () => {
    const harness = createTestHarness();
    const { app, seedUser } = harness;
    const alice = seedUser('alice@example.com');
    const bob = seedUser('bob@example.com');
    seedHistory(harness, alice.id);

    const response = await request(app)
      .get('/api/overview')
      .set('Authorization', `Bearer ${bob.token}`);

    expect(response.body.bodyComposition).toBeUndefined();
    expect(response.body.calories.logged).toBe(0);
  });
});

describe('body-composition trend endpoint', () => {
  it('returns insufficient-data with what is still needed, not a fake trend', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .get('/api/body-composition/trend?days=30')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('insufficient-data');
    expect(response.body.reasons).toContain('not-enough-weight-entries');
    expect(response.body.daysNeeded).toBeGreaterThan(0);
  });

  it('computes a trend once there is enough history', async () => {
    const harness = createTestHarness();
    const { app, seedUser } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);

    const response = await request(app)
      .get('/api/body-composition/trend?days=30')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.status).toBe('ok');
    expect(response.body.direction).toBe('losing');
    expect(response.body.avgDailyCalories).toBe(2100);
    expect(response.body.recommendation.action).toBeDefined();
  });

  it('rejects an out-of-range window', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    for (const days of ['0', '3', '1000', 'abc']) {
      const response = await request(app)
        .get(`/api/body-composition/trend?days=${days}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(400);
    }
  });
});

describe('AI evaluation lifecycle', () => {
  it('writes the deterministic trend before the AI runs, and reaches ready', async () => {
    const harness = createTestHarness();
    const { app, seedUser, store } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 87.8 });

    // The row exists with the trend already in it, regardless of the AI.
    expect(store.evaluations).toHaveLength(1);
    expect(store.evaluations[0]!.trend.status).toBe('ok');

    const response = await request(app)
      .get('/api/body-composition/evaluation')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ready');
    expect(response.body.summary).toBeTruthy();
    // The numbers are returned whatever the prose did.
    expect(response.body.trend.status).toBe('ok');
  });

  it('notifies exactly once, even across repeated polls', async () => {
    const harness = createTestHarness();
    const { app, seedUser, store, notifications } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);
    store.pushSubscriptions.push({
      id: 'ps-1',
      userId: id,
      playerId: 'player-abc-123',
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 87.8 });

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .get('/api/body-composition/evaluation')
        .set('Authorization', `Bearer ${token}`);
    }

    const readyEvents = notifications.sent.filter((n) => n.event === 'evaluation-ready');
    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0]!.playerIds).toEqual(['player-abc-123']);
  });

  it('respects a user who turned the AI evaluation off', async () => {
    const harness = createTestHarness();
    const { app, seedUser, store } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);
    store.users[0]!.preferences = { ai: { enabled: false } };

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 87.8 });

    expect(store.evaluations).toHaveLength(0);

    // The deterministic trend is still available — only the prose is skipped.
    const trend = await request(app)
      .get('/api/body-composition/trend?days=30')
      .set('Authorization', `Bearer ${token}`);
    expect(trend.body.status).toBe('ok');
  });

  it('creates no evaluation when there is too little history to evaluate', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-first-00001', date: '2026-03-01', weightKg: 90 });

    expect(store.evaluations).toHaveLength(0);
    const response = await request(app)
      .get('/api/body-composition/evaluation')
      .set('Authorization', `Bearer ${token}`);
    expect(response.body.status).toBe('none');
  });

  it('re-fires a pending evaluation left stale by a process that died mid-call', async () => {
    // The hanging provider stands in for the host sleeping during the AI call.
    const harness = createTestHarness({ ai: hangingAi() });
    const { app, seedUser, store, advance } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 87.8 });

    expect(store.evaluations[0]!.status).toBe('pending');
    const attemptsAfterStart = store.evaluations[0]!.attempts;

    // Before the staleness window, a poll must not retry.
    await request(app)
      .get('/api/body-composition/evaluation')
      .set('Authorization', `Bearer ${token}`);
    expect(store.evaluations[0]!.attempts).toBe(attemptsAfterStart);

    // Past the window, the reaper claims it again.
    advance(5 * 60 * 1000);
    await request(app)
      .get('/api/body-composition/evaluation')
      .set('Authorization', `Bearer ${token}`);
    expect(store.evaluations[0]!.attempts).toBeGreaterThan(attemptsAfterStart);
  });

  it('gives up after the attempt ceiling rather than staying pending forever', async () => {
    const harness = createTestHarness({ ai: hangingAi() });
    const { app, seedUser, store, advance } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 87.8 });

    let last;
    for (let i = 0; i < 6; i += 1) {
      advance(5 * 60 * 1000);
      last = await request(app)
        .get('/api/body-composition/evaluation')
        .set('Authorization', `Bearer ${token}`);
    }

    // This is the bug a two-state pending/ready model cannot express.
    expect(last!.body.status).toBe('failed');
    expect(last!.body.errorCode).toBe('AI_UNAVAILABLE');
    // The deterministic numbers survive the AI failure.
    expect(last!.body.trend.status).toBe('ok');
    expect(store.evaluations[0]!.attempts).toBeLessThanOrEqual(3);
  });

  it('still serves the trend when the AI provider fails outright', async () => {
    const harness = createTestHarness({ ai: failingAi() });
    const { app, seedUser, advance } = harness;
    const { token, id } = seedUser('a@example.com');
    seedHistory(harness, id);

    await request(app)
      .post('/api/body-composition/entry')
      .set('Authorization', `Bearer ${token}`)
      .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 87.8 });

    let response;
    for (let i = 0; i < 6; i += 1) {
      advance(5 * 60 * 1000);
      response = await request(app)
        .get('/api/body-composition/evaluation')
        .set('Authorization', `Bearer ${token}`);
    }

    expect(response!.body.status).toBe('failed');
    expect(response!.body.summary).toBeUndefined();
    expect(response!.body.trend.recommendation.action).toBeDefined();
  });
});

describe('billing placeholder', () => {
  it('always reports the free plan', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .get('/api/billing/status')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ plan: 'free', isPremium: false });
  });
});

describe('push registration', () => {
  it('registers a device and is idempotent', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const post = () =>
      request(app)
        .post('/api/notifications/subscribe')
        .set('Authorization', `Bearer ${token}`)
        .send({ oneSignalPlayerId: 'player-abc-123' });

    expect((await post()).status).toBe(204);
    expect((await post()).status).toBe(204);
    expect(store.pushSubscriptions).toHaveLength(1);
  });

  it('supports several devices for one account', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    for (const playerId of ['player-phone-1', 'player-laptop-2']) {
      await request(app)
        .post('/api/notifications/subscribe')
        .set('Authorization', `Bearer ${token}`)
        .send({ oneSignalPlayerId: playerId });
    }

    expect(store.pushSubscriptions).toHaveLength(2);
  });
});
