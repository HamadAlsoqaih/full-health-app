/**
 * The user's own foods. Offline-syncable, so the client id is an idempotency key.
 *
 * These are cached in full on the device: they are few, entirely user-owned, and
 * needed to log a meal without a connection.
 */
import type { CustomFood, CustomFoodInput } from '@app/shared-types';
import type { Repositories } from '../../repositories/index.js';
import { insertIdempotent } from '../offline-write.js';

export async function listCustomFoods(repos: Repositories, userId: string): Promise<CustomFood[]> {
  return repos.customFoods.list(userId);
}

export async function createCustomFood(
  repos: Repositories,
  userId: string,
  input: CustomFoodInput,
): Promise<{ row: CustomFood; replayed: boolean }> {
  return insertIdempotent(
    () => repos.customFoods.insert(userId, input),
    () => repos.customFoods.findByClientId(userId, input.clientId),
  );
}
