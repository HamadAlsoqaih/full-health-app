/**
 * User-built routines, assembled from the exercise library.
 */
import type { Routine, RoutineInput } from '@app/shared-types';
import type { Repositories } from '../../repositories/index.js';
import { badRequest, notFound } from '../../errors.js';

export async function listRoutines(repos: Repositories, userId: string): Promise<Routine[]> {
  return repos.routines.list(userId);
}

/**
 * Creates a routine, rejecting any exercise id that is not in the library.
 *
 * Validated here rather than left to a foreign key, because the exercises live in
 * a jsonb column and so have no referential integrity of their own. Without this
 * check a routine could reference an exercise that never existed and fail only
 * later, mid-workout.
 */
export async function createRoutine(
  repos: Repositories,
  userId: string,
  input: RoutineInput,
): Promise<Routine> {
  await assertExercisesExist(repos, input);
  return repos.routines.create(userId, input);
}

export async function updateRoutine(
  repos: Repositories,
  userId: string,
  id: string,
  patch: Partial<RoutineInput>,
): Promise<Routine> {
  const existing = await repos.routines.findById(userId, id);
  if (!existing) throw notFound('Routine not found.');
  if (patch.exercises) await assertExercisesExist(repos, { exercises: patch.exercises });
  return repos.routines.update(userId, id, patch);
}

export async function deleteRoutine(
  repos: Repositories,
  userId: string,
  id: string,
): Promise<void> {
  const existing = await repos.routines.findById(userId, id);
  if (!existing) throw notFound('Routine not found.');
  // Workout history survives: routine_id is ON DELETE SET NULL and each log keeps
  // its own routine_name snapshot.
  await repos.routines.remove(userId, id);
}

async function assertExercisesExist(
  repos: Repositories,
  input: Pick<RoutineInput, 'exercises'>,
): Promise<void> {
  const ids = [...new Set(input.exercises.map((e) => e.exerciseId))];
  const found = await Promise.all(ids.map((id) => repos.exercises.findById(id)));
  const missing = ids.filter((_, i) => !found[i]);
  if (missing.length > 0) {
    throw badRequest('Some exercises in this routine no longer exist.', {
      exercises: missing.map((id) => `Unknown exercise: ${id}`),
    });
  }
}
