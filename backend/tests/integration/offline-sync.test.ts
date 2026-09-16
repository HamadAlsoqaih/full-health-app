/**
 * The offline-sync idempotency contract.
 *
 * A queued write is resent until the server acknowledges it, so the guarantees
 * asserted here are what stop one logged workout becoming five after a flaky
 * reconnect:
 *
 *  - A replay returns 200 with a body identical to the original 201, so the
 *    client's outbox drops the item instead of retrying forever.
 *  - The key space is per user, so two users generating the same id do not
 *    collide — the reason the unique constraint is (user_id, client_id) and not
 *    client_id alone.
 *  - The key space is per resource, so the same id on a workout and a food is fine.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestHarness } from '../helpers/app.js';

const WORKOUT = {
  clientId: 'wl-client-00000001',
  routineId: null,
  routineName: 'Push A',
  completedAt: '2026-03-01T09:30:00.000Z',
  performed: [],
};

const MEASUREMENT = {
  clientId: 'bm-client-00000001',
  date: '2026-03-01',
  weightKg: 88.4,
};

const CUSTOM_FOOD = {
  clientId: 'cf-client-00000001',
  name: 'Protein shake',
  calories: 320,
  proteinG: 40,
  carbsG: 20,
  fatG: 8,
};

describe('workout log sync', () => {
  it('creates once with 201 and replays with an identical 200', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const post = () =>
      request(app).post('/api/workout-logs').set('Authorization', `Bearer ${token}`).send(WORKOUT);

    const first = await post();
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBeUndefined();

    const second = await post();
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');

    // Byte-identical, so the client needs no special case for a replay.
    expect(second.body).toEqual(first.body);
    expect(store.workoutLogs).toHaveLength(1);
  });

  it('stays at one row across many retries, as a flapping connection would cause', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app)
        .post('/api/workout-logs')
        .set('Authorization', `Bearer ${token}`)
        .send(WORKOUT);
      expect([200, 201]).toContain(response.status);
    }

    expect(store.workoutLogs).toHaveLength(1);
  });

  it('survives concurrent flushes of the same item', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    // Both requests can pass the middleware's read-then-write check; the unique
    // constraint decides, and insertIdempotent turns the loser into a replay.
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post('/api/workout-logs')
          .set('Authorization', `Bearer ${token}`)
          .send(WORKOUT),
      ),
    );

    for (const response of responses) {
      expect([200, 201]).toContain(response.status);
    }
    expect(store.workoutLogs).toHaveLength(1);
    // Exactly one caller was told it created the row.
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('lets two different users reuse the same clientId', async () => {
    const { app, seedUser, store } = createTestHarness();
    const alice = seedUser('alice@example.com');
    const bob = seedUser('bob@example.com');

    const first = await request(app)
      .post('/api/workout-logs')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(WORKOUT);
    const second = await request(app)
      .post('/api/workout-logs')
      .set('Authorization', `Bearer ${bob.token}`)
      .send(WORKOUT);

    // Under a global unique(client_id) this second insert would fail, and one
    // user could permanently block another's writes by guessing ids.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(store.workoutLogs).toHaveLength(2);
    expect(first.body.id).not.toBe(second.body.id);
  });

  it("does not leak another user's row through a replay lookup", async () => {
    const { app, seedUser } = createTestHarness();
    const alice = seedUser('alice@example.com');
    const bob = seedUser('bob@example.com');

    await request(app)
      .post('/api/workout-logs')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ ...WORKOUT, routineName: 'Alice secret routine' });

    const bobsView = await request(app)
      .post('/api/workout-logs')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ ...WORKOUT, routineName: 'Bob routine' });

    expect(bobsView.status).toBe(201);
    expect(bobsView.body.routineName).toBe('Bob routine');

    const list = await request(app)
      .get('/api/workout-logs')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('Alice secret');
  });

  it('rejects a clientId that is too short to be a real key', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .post('/api/workout-logs')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...WORKOUT, clientId: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.clientId).toBeDefined();
  });
});

describe('body measurement sync', () => {
  it('replays with 200 and does not duplicate', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const post = () =>
      request(app)
        .post('/api/body-composition/entry')
        .set('Authorization', `Bearer ${token}`)
        .send(MEASUREMENT);

    expect((await post()).status).toBe(201);
    const replay = await post();

    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(store.bodyMeasurements).toHaveLength(1);
  });

  it('does not start a second AI evaluation for a replayed measurement', async () => {
    // A 30-day history, so the measurement is enough to trigger an evaluation.
    const { app, seedUser, store } = createTestHarness();
    const { token, id } = seedUser('a@example.com');

    for (let d = 30; d >= 1; d -= 1) {
      const date = new Date(Date.UTC(2026, 1, 1) + (30 - d) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      store.bodyMeasurements.push({
        id: `seed-${d}`,
        userId: id,
        clientId: `seed-bm-${d}`,
        date,
        weightKg: 90 - (30 - d) * 0.05,
        createdAt: `${date}T08:00:00.000Z`,
      });
      store.foodLog.push({
        id: `seed-f-${d}`,
        userId: id,
        clientId: `seed-fl-${d}`,
        date,
        foodItemId: 'manual:',
        foodName: 'Seed',
        source: 'manual',
        servingLabel: '1 serving',
        servingMultiplier: 1,
        baseCalories: 2000,
        baseProteinG: 150,
        baseCarbsG: 200,
        baseFatG: 60,
        calories: 2000,
        proteinG: 150,
        carbsG: 200,
        fatG: 60,
        loggedAt: `${date}T20:00:00.000Z`,
      });
    }

    const post = () =>
      request(app)
        .post('/api/body-composition/entry')
        .set('Authorization', `Bearer ${token}`)
        .send({ clientId: 'bm-trigger-0001', date: '2026-03-01', weightKg: 88 });

    await post();
    const evaluationsAfterFirst = store.evaluations.length;
    expect(evaluationsAfterFirst).toBe(1);

    await post();
    // A replay must not queue a second evaluation for the same measurement.
    expect(store.evaluations).toHaveLength(evaluationsAfterFirst);
  });
});

describe('custom food sync', () => {
  it('replays with 200 and does not duplicate', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const post = () =>
      request(app)
        .post('/api/nutrition/custom-foods')
        .set('Authorization', `Bearer ${token}`)
        .send(CUSTOM_FOOD);

    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(200);
    expect(store.customFoods).toHaveLength(1);
  });
});

describe('food log sync', () => {
  it('is offline-syncable, so a meal logged without a connection is not lost', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    // A custom food, because that is what a user can create while offline.
    const food = await authed(request(app).post('/api/nutrition/custom-foods').send(CUSTOM_FOOD));

    const payload = {
      clientId: 'fl-client-00000001',
      foodItemId: `custom:${food.body.id}`,
      date: '2026-03-01',
      servingMultiplier: 1.5,
    };

    const first = await authed(request(app).post('/api/nutrition/log').send(payload));
    expect(first.status).toBe(201);
    // Macros are resolved server-side and multiplied: 320 x 1.5.
    expect(first.body.calories).toBe(480);
    expect(first.body.proteinG).toBe(60);
    expect(first.body.foodName).toBe('Protein shake');

    const replay = await authed(request(app).post('/api/nutrition/log').send(payload));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(store.foodLog).toHaveLength(1);
  });

  it('allows the same clientId across different resource types', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
    const sharedId = 'shared-key-000001';

    const workout = await authed(
      request(app)
        .post('/api/workout-logs')
        .send({ ...WORKOUT, clientId: sharedId }),
    );
    const food = await authed(
      request(app)
        .post('/api/nutrition/custom-foods')
        .send({ ...CUSTOM_FOOD, clientId: sharedId }),
    );
    const measurement = await authed(
      request(app)
        .post('/api/body-composition/entry')
        .send({ ...MEASUREMENT, clientId: sharedId }),
    );

    // Key space is per resource: no shared idempotency table, so no false replay.
    expect(workout.status).toBe(201);
    expect(food.status).toBe(201);
    expect(measurement.status).toBe(201);
  });

  it("refuses to log another user's custom food", async () => {
    const { app, seedUser } = createTestHarness();
    const alice = seedUser('alice@example.com');
    const bob = seedUser('bob@example.com');

    const food = await request(app)
      .post('/api/nutrition/custom-foods')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(CUSTOM_FOOD);

    const response = await request(app)
      .post('/api/nutrition/log')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({
        clientId: 'fl-bob-00000001',
        foodItemId: `custom:${food.body.id}`,
        date: '2026-03-01',
        servingMultiplier: 1,
      });

    // 404 rather than 403: acknowledging it exists would confirm another user's data.
    expect(response.status).toBe(404);
  });
});
