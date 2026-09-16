/**
 * Exercise library. Global reference data, seeded once from Free Exercise DB.
 */
import type { Exercise, MuscleGroup } from '@app/shared-types';
import type { Repositories } from '../../repositories/index.js';

export async function listExercises(
  repos: Repositories,
  filter: { muscleGroup?: string; q?: string },
): Promise<Exercise[]> {
  return repos.exercises.list({
    ...(filter.muscleGroup ? { muscleGroup: filter.muscleGroup as MuscleGroup } : {}),
    ...(filter.q ? { search: filter.q } : {}),
  });
}
