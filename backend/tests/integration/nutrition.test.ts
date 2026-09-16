/**
 * Nutrition: the cache-first rule and the never-auto-log rule.
 *
 * Both are architectural constraints rather than features, so they are asserted
 * by observing behaviour the implementation cannot fake: the fake food database
 * records its calls, and the store is inspected for rows that must not exist.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { FoodItem } from '@app/shared-types';
import { createTestHarness } from '../helpers/app.js';

const OATS: FoodItem = {
  id: 'usda:12345',
  name: 'Oats, rolled',
  source: 'usda',
  servingLabel: '100 g',
  calories: 379,
  proteinG: 13.2,
  carbsG: 67.7,
  fatG: 6.5,
};

describe('food search is cache-first (spec rule 6)', () => {
  it('calls the upstream once, then serves the repeat from cache', async () => {
    const harness = createTestHarness({ foodDbItems: [OATS] });
    const { app, seedUser, foodDb } = harness;
    const { token } = seedUser('a@example.com');
    const search = () =>
      request(app).get('/api/nutrition/search?q=oats').set('Authorization', `Bearer ${token}`);

    const first = await search();
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.fromCache).toBe(false);
    expect(foodDb.calls.search).toEqual(['oats']);

    const second = await search();
    expect(second.body.items).toHaveLength(1);
    expect(second.body.fromCache).toBe(true);
    // The upstream was NOT consulted again. Both quotas are shared across the
    // whole deployment, so an uncached repeat spends everyone's budget.
    expect(foodDb.calls.search).toEqual(['oats']);
  });

  it('caches a fruitless search too, so it is not repeated upstream', async () => {
    const harness = createTestHarness({ foodDbItems: [] });
    const { app, seedUser, foodDb } = harness;
    const { token } = seedUser('a@example.com');

    await request(app)
      .get('/api/nutrition/search?q=nonexistentfood')
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .get('/api/nutrition/search?q=nonexistentfood')
      .set('Authorization', `Bearer ${token}`);

    expect(foodDb.calls.search).toHaveLength(1);
  });

  it('normalises the query so trivial variations share one cache entry', async () => {
    const harness = createTestHarness({ foodDbItems: [OATS] });
    const { app, seedUser, foodDb } = harness;
    const { token } = seedUser('a@example.com');

    for (const q of ['oats', 'OATS', '  oats  ']) {
      await request(app)
        .get(`/api/nutrition/search?q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${token}`);
    }

    expect(foodDb.calls.search).toHaveLength(1);
  });

  it('reports a failing source instead of failing the whole search', async () => {
    const harness = createTestHarness({ foodDbItems: [OATS] });
    const { app, seedUser, foodDb, store, deps } = harness;
    const { token, id } = seedUser('a@example.com');

    // The user's own food must still come back when the upstream is down.
    store.customFoods.push({
      id: 'cf-1',
      userId: id,
      clientId: 'cf-client-1',
      name: 'Oats with milk',
      servingLabel: '1 bowl',
      calories: 400,
      proteinG: 20,
      carbsG: 55,
      fatG: 10,
      createdAt: deps.clock().toISOString(),
    });

    foodDb.failNext();

    const response = await request(app)
      .get('/api/nutrition/search?q=oats')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.unavailableSources).toContain('usda');
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].name).toBe('Oats with milk');
  });

  it("returns the user's own foods ahead of upstream results", async () => {
    const harness = createTestHarness({ foodDbItems: [OATS] });
    const { app, seedUser, store, deps } = harness;
    const { token, id } = seedUser('a@example.com');

    store.customFoods.push({
      id: 'cf-1',
      userId: id,
      clientId: 'cf-client-1',
      name: 'Oats, my recipe',
      servingLabel: '1 bowl',
      calories: 400,
      proteinG: 20,
      carbsG: 55,
      fatG: 10,
      createdAt: deps.clock().toISOString(),
    });

    const response = await request(app)
      .get('/api/nutrition/search?q=oats')
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.items[0].source).toBe('custom');
  });

  it('rejects a query too short to be meaningful', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .get('/api/nutrition/search?q=a')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(400);
  });
});

describe('photo scan never auto-logs (spec rule 3)', () => {
  it('returns an estimate and writes no food-log row', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .post('/api/nutrition/scan-photo')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from('fake-jpeg-bytes'), {
        filename: 'meal.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(200);
    expect(response.body.estimate.calories).toBeGreaterThan(0);
    expect(response.body.confidence).toBe('low');
    // Explicit on the wire, not merely implied by the absence of a row.
    expect(response.body.autoLogged).toBe(false);

    // The actual assertion: nothing was logged.
    expect(store.foodLog).toHaveLength(0);
  });

  it('persists the estimate so the confirmation can be resolved server-side', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const scan = await request(app)
      .post('/api/nutrition/scan-photo')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from('fake-jpeg-bytes'), {
        filename: 'meal.jpg',
        contentType: 'image/jpeg',
      });

    const estimateId = scan.body.estimate.id as string;
    expect(estimateId).toMatch(/^estimate:/);
    expect(store.foodCache.some((c) => c.kind === 'estimate')).toBe(true);

    // Confirming goes through the ordinary log endpoint; the server re-resolves
    // the macros rather than trusting anything the client sends back.
    const confirmed = await request(app)
      .post('/api/nutrition/log')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId: 'fl-confirm-000001',
        foodItemId: estimateId,
        date: '2026-03-01',
        servingMultiplier: 1,
      });

    expect(confirmed.status).toBe(201);
    expect(confirmed.body.source).toBe('ai-photo-estimate');
    expect(confirmed.body.calories).toBe(scan.body.estimate.calories);
    expect(store.foodLog).toHaveLength(1);
  });

  it('does not store the image itself, only the resulting numbers', async () => {
    const { app, seedUser, store } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const marker = 'UNIQUE-IMAGE-BYTES-MARKER';
    await request(app)
      .post('/api/nutrition/scan-photo')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from(marker), {
        filename: 'meal.jpg',
        contentType: 'image/jpeg',
      });

    // Nothing anywhere in the datastore contains the image payload.
    expect(JSON.stringify(store)).not.toContain(marker);
  });

  it('rejects a non-image upload', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .post('/api/nutrition/scan-photo')
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from('#!/bin/sh\necho hi'), {
        filename: 'script.sh',
        contentType: 'application/x-sh',
      });

    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a request with no file attached', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .post('/api/nutrition/scan-photo')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it("cannot resolve another user's estimate", async () => {
    const { app, seedUser } = createTestHarness();
    const alice = seedUser('alice@example.com');
    const bob = seedUser('bob@example.com');

    const scan = await request(app)
      .post('/api/nutrition/scan-photo')
      .set('Authorization', `Bearer ${alice.token}`)
      .attach('photo', Buffer.from('fake'), {
        filename: 'meal.jpg',
        contentType: 'image/jpeg',
      });

    const response = await request(app)
      .post('/api/nutrition/log')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({
        clientId: 'fl-bob-000001',
        foodItemId: scan.body.estimate.id,
        date: '2026-03-01',
        servingMultiplier: 1,
      });

    expect(response.status).toBe(404);
  });
});

describe('daily log', () => {
  it('returns entries for one day only', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    const food = await authed(
      request(app).post('/api/nutrition/custom-foods').send({
        clientId: 'cf-client-000001',
        name: 'Rice',
        calories: 200,
        proteinG: 4,
        carbsG: 45,
        fatG: 1,
      }),
    );

    for (const [i, date] of ['2026-03-01', '2026-03-02'].entries()) {
      await authed(
        request(app)
          .post('/api/nutrition/log')
          .send({
            clientId: `fl-client-00000${i + 1}`,
            foodItemId: `custom:${food.body.id}`,
            date,
            servingMultiplier: 1,
          }),
      );
    }

    const day = await authed(request(app).get('/api/nutrition/log?date=2026-03-01'));
    expect(day.body).toHaveLength(1);
    expect(day.body[0].date).toBe('2026-03-01');
  });

  it('requires a well-formed date', async () => {
    const { app, seedUser } = createTestHarness();
    const { token } = seedUser('a@example.com');

    for (const date of ['', '01-03-2026', '2026-13-45', 'today']) {
      const response = await request(app)
        .get(`/api/nutrition/log?date=${date}`)
        .set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(400);
    }
  });
});
