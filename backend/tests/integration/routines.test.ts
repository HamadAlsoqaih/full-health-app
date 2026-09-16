/**
 * Routines: CRUD, cross-user isolation, and the history-preservation rule.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestHarness, type TestHarness } from '../helpers/app.js';

const EXERCISE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_EXERCISE_ID = '22222222-2222-4222-8222-222222222222';

function seedExercises(harness: TestHarness): void {
  harness.store.exercises.push(
    {
      id: EXERCISE_ID,
      externalId: 'Barbell_Squat',
      name: 'Barbell Squat',
      muscleGroup: 'quadriceps',
      secondaryMuscles: ['glutes'],
      category: 'strength',
      level: 'intermediate',
      instructions: ['Squat.'],
      mediaUrl: 'https://example.test/squat.jpg',
    },
    {
      id: OTHER_EXERCISE_ID,
      externalId: 'Bench_Press',
      name: 'Bench Press',
      muscleGroup: 'chest',
      secondaryMuscles: ['triceps'],
      category: 'strength',
      level: 'beginner',
      instructions: ['Press.'],
    },
  );
}

const routinePayload = (exerciseId = EXERCISE_ID) => ({
  name: 'Leg Day',
  exercises: [
    { exerciseId, exerciseName: 'Barbell Squat', sets: 5, targetReps: 5, targetWeightKg: 100 },
  ],
});

describe('routines', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
    seedExercises(harness);
  });

  it('creates, lists, updates and deletes', async () => {
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    const created = await authed(request(app).post('/api/routines').send(routinePayload()));
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Leg Day');
    expect(created.body.exercises).toHaveLength(1);

    const listed = await authed(request(app).get('/api/routines'));
    expect(listed.body).toHaveLength(1);

    const updated = await authed(
      request(app).put(`/api/routines/${created.body.id}`).send({ name: 'Leg Day B' }),
    );
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Leg Day B');
    // A partial update must not wipe the fields it did not mention.
    expect(updated.body.exercises).toHaveLength(1);

    const removed = await authed(request(app).delete(`/api/routines/${created.body.id}`));
    expect(removed.status).toBe(204);
    expect((await authed(request(app).get('/api/routines'))).body).toHaveLength(0);
  });

  it('rejects a routine referencing an exercise that does not exist', async () => {
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .post('/api/routines')
      .set('Authorization', `Bearer ${token}`)
      .send(routinePayload('33333333-3333-4333-8333-333333333333'));

    // The exercises live in a jsonb column with no foreign key, so this is checked
    // in the service; otherwise it would fail later, mid-workout.
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an empty routine and an over-long name', async () => {
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    expect(
      (await authed(request(app).post('/api/routines').send({ name: 'Empty', exercises: [] })))
        .status,
    ).toBe(400);

    expect(
      (
        await authed(
          request(app)
            .post('/api/routines')
            .send({ ...routinePayload(), name: 'x'.repeat(200) }),
        )
      ).status,
    ).toBe(400);
  });

  it("does not expose one user's routines to another", async () => {
    const { app, seedUser } = harness;
    const alice = seedUser('alice@example.com');
    const bob = seedUser('bob@example.com');

    const created = await request(app)
      .post('/api/routines')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ ...routinePayload(), name: 'Alice Only' });

    const bobList = await request(app)
      .get('/api/routines')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(bobList.body).toHaveLength(0);

    // Reading, updating and deleting by id must all fail for a non-owner.
    for (const attempt of [
      request(app).put(`/api/routines/${created.body.id}`).send({ name: 'Hijacked' }),
      request(app).delete(`/api/routines/${created.body.id}`),
    ]) {
      const response = await attempt.set('Authorization', `Bearer ${bob.token}`);
      expect(response.status).toBe(404);
    }

    // Alice's routine is untouched.
    const aliceList = await request(app)
      .get('/api/routines')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(aliceList.body[0].name).toBe('Alice Only');
  });

  it('preserves workout history when the routine is deleted', async () => {
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    const routine = await authed(request(app).post('/api/routines').send(routinePayload()));

    await authed(
      request(app)
        .post('/api/workout-logs')
        .send({
          clientId: 'wl-history-0001',
          routineId: routine.body.id,
          routineName: 'Leg Day',
          completedAt: '2026-03-01T09:00:00.000Z',
          performed: [
            {
              exerciseId: EXERCISE_ID,
              exerciseName: 'Barbell Squat',
              sets: [
                { reps: 5, weightKg: 100 },
                { reps: 5, weightKg: 100 },
              ],
            },
          ],
        }),
    );

    await authed(request(app).delete(`/api/routines/${routine.body.id}`));

    const history = await authed(request(app).get('/api/workout-logs'));
    expect(history.body).toHaveLength(1);
    // The reference is gone but the record of what was done survives.
    expect(history.body[0].routineId).toBeNull();
    expect(history.body[0].routineName).toBe('Leg Day');
    expect(history.body[0].performed[0].sets).toHaveLength(2);
    expect(history.body[0].performed[0].sets[0].weightKg).toBe(100);
  });

  it('rejects a non-uuid route parameter before touching the database', async () => {
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .put('/api/routines/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x' });

    expect(response.status).toBe(400);
  });
});

describe('exercise library', () => {
  it('lists and filters by muscle group', async () => {
    const harness = createTestHarness();
    seedExercises(harness);
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');
    const authed = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    expect((await authed(request(app).get('/api/exercises'))).body).toHaveLength(2);

    const chest = await authed(request(app).get('/api/exercises?muscleGroup=chest'));
    expect(chest.body).toHaveLength(1);
    expect(chest.body[0].name).toBe('Bench Press');

    const search = await authed(request(app).get('/api/exercises?q=squat'));
    expect(search.body).toHaveLength(1);
  });

  it('returns media as a URL string, never binary', async () => {
    const harness = createTestHarness();
    seedExercises(harness);
    const { app, seedUser } = harness;
    const { token } = seedUser('a@example.com');

    const response = await request(app)
      .get('/api/exercises?muscleGroup=quadriceps')
      .set('Authorization', `Bearer ${token}`);

    expect(typeof response.body[0].mediaUrl).toBe('string');
    expect(response.body[0].mediaUrl).toMatch(/^https:\/\//);
  });
});
