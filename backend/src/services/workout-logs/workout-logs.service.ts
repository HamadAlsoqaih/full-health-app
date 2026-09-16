/**
 * Completed workouts. Offline-syncable: a write can be queued on the device and
 * replayed later, so the client-generated id is the idempotency key.
 */
import type { WorkoutLog, WorkoutLogInput } from '@app/shared-types';
import type { Repositories } from '../../repositories/index.js';
import { insertIdempotent } from '../offline-write.js';

export async function listWorkoutLogs(
  repos: Repositories,
  userId: string,
  limit?: number,
): Promise<WorkoutLog[]> {
  return repos.workoutLogs.list(userId, limit);
}

/**
 * Records a completed workout.
 *
 * Returns `replayed` so the controller can answer 200 rather than 201 when this
 * write has already been stored — which is what lets the offline outbox drop the
 * queued item instead of retrying it forever.
 */
export async function logWorkout(
  repos: Repositories,
  userId: string,
  input: WorkoutLogInput,
): Promise<{ row: WorkoutLog; replayed: boolean }> {
  return insertIdempotent(
    () => repos.workoutLogs.insert(userId, input),
    () => repos.workoutLogs.findByClientId(userId, input.clientId),
  );
}
