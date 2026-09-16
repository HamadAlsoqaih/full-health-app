/**
 * User profile, and the onboarding-progress derivation.
 *
 * Onboarding keeps no data model of its own (spec rule 11): it seeds two other
 * domains and its progress is inferred from them. `goals` being populated means
 * step 2 landed; the existence of any body measurement means step 3 landed. That
 * inference is what makes resume-after-close possible without an onboarding table.
 *
 * `onboarding_complete` is flipped lazily here, in one place, rather than by the
 * client or by the body-composition endpoint. A client-driven flag could be forged
 * to skip the flow; putting it in the measurement endpoint would couple body
 * composition to onboarding for the rest of the app's life.
 */
import type {
  AuthUser,
  Goals,
  OnboardingProgress,
  UserPreferences,
  UserUpdateInput,
} from '@app/shared-types';
import type { UserRow } from '../../models/index.js';
import type { Repositories } from '../../repositories/index.js';
import { notFound } from '../../errors.js';

/** Applied to any user whose stored preferences predate a new field. */
const DEFAULT_PREFERENCES: UserPreferences = {
  notifications: { remindersEnabled: true, evaluationReadyEnabled: true },
  ai: { enabled: true, photoScanEnabled: true, evaluationEnabled: true },
};

function mergePreferences(stored: unknown): UserPreferences {
  if (!stored || typeof stored !== 'object') return DEFAULT_PREFERENCES;
  const s = stored as Partial<UserPreferences>;
  return {
    notifications: { ...DEFAULT_PREFERENCES.notifications, ...(s.notifications ?? {}) },
    ai: { ...DEFAULT_PREFERENCES.ai, ...(s.ai ?? {}) },
  };
}

function hasGoals(goals: unknown): goals is Goals {
  return Boolean(goals && typeof goals === 'object' && typeof (goals as Goals).goal === 'string');
}

function toAuthUser(row: UserRow, onboarding: OnboardingProgress): AuthUser {
  return {
    id: row.id,
    email: row.email,
    units: row.units,
    preferences: mergePreferences(row.preferences),
    onboarding,
    createdAt: row.createdAt,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(hasGoals(row.goals) ? { goals: row.goals } : {}),
  };
}

/**
 * Creates or refreshes the public mirror of an auth user.
 *
 * Called from register, login AND getMe. Register alone is not enough: OAuth
 * sign-in never touches /auth/register, so a user could otherwise reach the app
 * with no public row. It is not in the auth middleware, which would add a write to
 * every single request.
 *
 * Implemented in application code rather than as a Postgres trigger on auth.users
 * so it is testable — a trigger lives inside Supabase and is invisible to a suite
 * running with no credentials.
 */
export async function ensureUserRow(
  repos: Repositories,
  userId: string,
  email: string,
): Promise<UserRow> {
  return repos.users.ensure(userId, email);
}

export async function getMe(repos: Repositories, userId: string): Promise<AuthUser> {
  const row = await repos.users.findById(userId);
  if (!row) throw notFound('User profile not found.');

  const goalsSubmitted = hasGoals(row.goals);
  const startingStatsSubmitted = await repos.users.hasAnyMeasurement(userId);

  // Self-healing: if both onboarding writes landed but the app closed before the
  // final step, mark it complete now rather than stranding the user in the flow.
  let complete = row.onboardingComplete;
  if (!complete && goalsSubmitted && startingStatsSubmitted) {
    const updated = await repos.users.update(userId, { onboardingComplete: true });
    complete = updated.onboardingComplete;
    return toAuthUser(updated, { goalsSubmitted, startingStatsSubmitted, complete });
  }

  return toAuthUser(row, { goalsSubmitted, startingStatsSubmitted, complete });
}

/**
 * Applies a client-supplied patch.
 *
 * Only the fields in UserUpdateInput are writable. `id`, `email` and everything
 * under `onboarding` are server-owned — accepting a partial AuthUser here would let
 * a client PUT `onboardingComplete: true` and skip the flow entirely, or desync its
 * email from the auth record.
 */
export async function updateMe(
  repos: Repositories,
  userId: string,
  input: UserUpdateInput,
): Promise<AuthUser> {
  const current = await repos.users.findById(userId);
  if (!current) throw notFound('User profile not found.');

  const patch: Partial<UserRow> = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.units !== undefined) patch.units = input.units;
  if (input.goals !== undefined) patch.goals = input.goals;
  if (input.preferences !== undefined) {
    const merged = mergePreferences(current.preferences);
    patch.preferences = {
      notifications: { ...merged.notifications, ...(input.preferences.notifications ?? {}) },
      ai: { ...merged.ai, ...(input.preferences.ai ?? {}) },
    } satisfies UserPreferences;
  }

  await repos.users.update(userId, patch);
  return getMe(repos, userId);
}

/**
 * Records the onboarding goals answers (steps 2 and 4).
 *
 * Dietary preferences ride inside `goals` because step 4 has no endpoint of its
 * own in the API surface, which is also why there are exactly two post-signup
 * writes and therefore exactly two resume states.
 */
export async function submitOnboarding(
  repos: Repositories,
  userId: string,
  goals: Goals,
): Promise<AuthUser> {
  await repos.users.update(userId, { goals });
  return getMe(repos, userId);
}
