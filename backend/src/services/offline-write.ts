/**
 * The race the idempotency middleware cannot close.
 *
 * Two queued flushes can arrive close enough together that both pass the
 * read-then-write check and both attempt an insert. The unique constraint on
 * (user_id, client_id) rejects the loser with Postgres 23505; this helper catches
 * that, re-reads the row the winner wrote, and returns it.
 *
 * So the middleware is an optimisation and the constraint is the correctness
 * guarantee. Both paths produce the same 200-with-the-stored-row result, which is
 * what the offline outbox needs in order to drop the item rather than retry it.
 */
import { conflict, isUniqueViolation } from '../errors.js';

export async function insertIdempotent<T>(
  insert: () => Promise<T>,
  reread: () => Promise<T | null>,
): Promise<{ row: T; replayed: boolean }> {
  try {
    return { row: await insert(), replayed: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await reread();
    if (existing) return { row: existing, replayed: true };

    // A unique violation with nothing to re-read means the constraint that fired was
    // not the idempotency key — surfacing it is better than reporting a false replay.
    throw conflict('That record conflicts with one that already exists.');
  }
}
