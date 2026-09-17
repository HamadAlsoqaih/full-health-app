/**
 * The two-pass photo scan: estimate, questions, answers, revised estimate.
 *
 * Why this exists at all is worth stating. A photograph does not contain what
 * dominates the error in a calorie estimate — cooking method, hidden volume and
 * added fat are all invisible — so the model is asked to name its own
 * uncertainty and the user answers it. The stub provider implements both passes
 * deterministically, which is what makes the whole flow testable with no API key.
 *
 * Two properties here are security, not features:
 *
 *  - The previous estimate is read from the caller's OWN cache, never from the
 *    request body. Otherwise a client could claim any starting numbers and have
 *    the model "revise" toward them.
 *  - The second pass counts against the account-wide vision quota, because it is
 *    a second real call to the model.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestHarness } from '../helpers/app.js';

/** A minimal but real JPEG-ish payload; the stub only reads its length. */
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

function harnessWithUser() {
  const harness = createTestHarness();
  const { token, id } = harness.seedUser('a@example.com');
  return {
    ...harness,
    userId: id,
    authed: (r: request.Test) => r.set('Authorization', `Bearer ${token}`),
  };
}

/** Runs the first pass and returns its body. */
async function scan(h: ReturnType<typeof harnessWithUser>) {
  const response = await h.authed(
    request(h.app).post('/api/nutrition/scan-photo').attach('photo', PHOTO, 'meal.jpg'),
  );
  expect(response.status).toBe(200);
  return response.body as {
    estimate: { id: string; calories: number };
    questions?: Array<{ id: string; question: string; options: string[] }>;
  };
}

describe('POST /nutrition/scan-photo', () => {
  it('returns questions the photo cannot answer', async () => {
    const h = harnessWithUser();
    const body = await scan(h);

    expect(body.questions).toBeDefined();
    expect(body.questions!.length).toBeGreaterThan(0);
    expect(body.questions!.map((q) => q.id)).toContain('cooking-method');
  });

  it('ends every question with an explicit "Not sure"', async () => {
    const h = harnessWithUser();
    const body = await scan(h);

    // An honest unknown is more useful than a forced guess between air fried
    // and deep fried, so the escape hatch is on every question.
    for (const question of body.questions ?? []) {
      expect(question.options.at(-1)).toBe('Not sure');
      expect(question.options.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('still logs nothing by itself', async () => {
    const h = harnessWithUser();
    await scan(h);
    expect(h.store.foodLog).toHaveLength(0);
  });
});

describe('POST /nutrition/scan-photo/refine', () => {
  it('revises the estimate using the answers', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field(
          'answers',
          JSON.stringify({
            previousEstimateId: first.estimate.id,
            answers: [
              {
                questionId: 'cooking-method',
                question: 'How was this cooked?',
                option: 'Deep fried',
              },
            ],
          }),
        ),
    );

    expect(response.status).toBe(200);
    // The stub raises the estimate for deep frying, so the answer demonstrably
    // reached the model and changed the number.
    expect(response.body.estimate.calories).toBeGreaterThan(first.estimate.calories);
  });

  it('reports what the number was before, so the change is visible', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field(
          'answers',
          JSON.stringify({
            previousEstimateId: first.estimate.id,
            answers: [
              {
                questionId: 'cooking-method',
                question: 'How was this cooked?',
                option: 'Air fried',
              },
            ],
          }),
        ),
    );

    // Without this the screen can only show a new number, and there is no way
    // to tell whether answering was worth doing.
    expect(response.body.previousCalories).toBe(first.estimate.calories);
    expect(response.body.estimate.calories).toBeLessThan(first.estimate.calories);
  });

  it('keeps the same estimate id, so the confirmation resolves the revised numbers', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field('answers', JSON.stringify({ previousEstimateId: first.estimate.id, answers: [] })),
    );

    // Revised, not replaced: the cache row the eventual log reads is the same
    // one, now holding the better numbers.
    expect(response.body.estimate.id).toBe(first.estimate.id);
  });

  it('asks no further questions — one round, not an interrogation', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field('answers', JSON.stringify({ previousEstimateId: first.estimate.id, answers: [] })),
    );

    expect(response.body.questions).toBeUndefined();
  });

  it('accepts a free-text note alongside the answers', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field(
          'answers',
          JSON.stringify({
            previousEstimateId: first.estimate.id,
            answers: [],
            note: 'The rice had butter mixed through it.',
          }),
        ),
    );

    expect(response.status).toBe(200);
  });

  it('logs nothing by itself either', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field('answers', JSON.stringify({ previousEstimateId: first.estimate.id, answers: [] })),
    );

    // Spec rule 3 holds across both passes.
    expect(h.store.foodLog).toHaveLength(0);
  });
});

describe('refining what is not yours, or not there', () => {
  it('refuses an estimate id that does not exist', async () => {
    const h = harnessWithUser();

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field('answers', JSON.stringify({ previousEstimateId: 'estimate:nope', answers: [] })),
    );

    expect(response.status).toBe(404);
  });

  it("refuses another user's estimate", async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    // A second account, asking to refine the first account's estimate.
    const other = h.seedUser('b@example.com');
    const response = await request(h.app)
      .post('/api/nutrition/scan-photo/refine')
      .set('Authorization', `Bearer ${other.token}`)
      .attach('photo', PHOTO, 'meal.jpg')
      .field('answers', JSON.stringify({ previousEstimateId: first.estimate.id, answers: [] }));

    // The lookup is scoped to the caller, so this is indistinguishable from an
    // id that never existed — which is also the right answer.
    expect(response.status).toBe(404);
  });

  it('requires a photo', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .field('answers', JSON.stringify({ previousEstimateId: first.estimate.id, answers: [] })),
    );

    expect(response.status).toBe(400);
  });

  it('rejects answers that are not valid JSON', async () => {
    const h = harnessWithUser();

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field('answers', 'not json at all'),
    );

    expect(response.status).toBe(400);
  });

  it('rejects more answers than there could ever be questions', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field(
          'answers',
          JSON.stringify({
            previousEstimateId: first.estimate.id,
            answers: Array.from({ length: 9 }, (_, i) => ({
              questionId: `q${i}`,
              question: `Question ${i}?`,
              option: 'Yes',
            })),
          }),
        ),
    );

    // The parser never produces more than three questions, so nine answers is
    // not a user doing anything real.
    expect(response.status).toBe(400);
  });

  it('rejects a note long enough to be an essay', async () => {
    const h = harnessWithUser();
    const first = await scan(h);

    const response = await h.authed(
      request(h.app)
        .post('/api/nutrition/scan-photo/refine')
        .attach('photo', PHOTO, 'meal.jpg')
        .field(
          'answers',
          JSON.stringify({
            previousEstimateId: first.estimate.id,
            answers: [],
            note: 'x'.repeat(5000),
          }),
        ),
    );

    // It is free text going into a prompt; a bound is the whole protection.
    expect(response.status).toBe(400);
  });

  it('requires a session', async () => {
    const h = harnessWithUser();

    const response = await request(h.app)
      .post('/api/nutrition/scan-photo/refine')
      .attach('photo', PHOTO, 'meal.jpg')
      .field('answers', JSON.stringify({ previousEstimateId: 'estimate:x', answers: [] }));

    expect(response.status).toBe(401);
  });
});
