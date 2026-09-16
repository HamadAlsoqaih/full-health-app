/**
 * The Overview tab's single endpoint.
 *
 * Aggregation happens here, server-side, because the alternative is the dashboard
 * firing five requests on every app open and stitching them together — which on a
 * phone on mobile data is both slow and where inconsistent snapshots come from
 * (calories from one moment, weight from another).
 *
 * The client-side counterpart of this rule is that OverviewDashboard imports no
 * other feature's api module (spec rule 5).
 */
import type { Goals, OverviewSummary } from '@app/shared-types';
import type { Repositories } from '../../repositories/index.js';
import type { BodyCompDeps } from '../body-composition/body-composition.service.js';
import { getTrend } from '../body-composition/body-composition.service.js';
import { totalsFor } from '../nutrition/nutrition.service.js';

const TREND_WINDOW_DAYS = 30;

/**
 * Picks the routine to surface as "next".
 *
 * Without a scheduling model, "next" is a heuristic: the routine the user has not
 * done for longest, falling back to the most recently created. Stated plainly
 * because it is a guess, not a plan — a real schedule would need its own model.
 */
async function pickNextRoutine(
  repos: Repositories,
  userId: string,
): Promise<OverviewSummary['nextRoutine']> {
  const routines = await repos.routines.list(userId);
  if (routines.length === 0) return undefined;

  const recent = await repos.workoutLogs.list(userId, 50);
  const lastDoneAt = new Map<string, string>();
  for (const log of recent) {
    if (!log.routineId) continue;
    const existing = lastDoneAt.get(log.routineId);
    if (!existing || log.completedAt > existing) lastDoneAt.set(log.routineId, log.completedAt);
  }

  const sorted = [...routines].sort((a, b) => {
    // Never-done routines first, then least recently done.
    const aDone = lastDoneAt.get(a.id) ?? '';
    const bDone = lastDoneAt.get(b.id) ?? '';
    return aDone.localeCompare(bDone) || b.createdAt.localeCompare(a.createdAt);
  });

  const next = sorted[0];
  if (!next) return undefined;
  return { id: next.id, name: next.name, exerciseCount: next.exercises.length };
}

export async function getOverview(deps: BodyCompDeps, userId: string): Promise<OverviewSummary> {
  const { repos, clock } = deps;
  const today = clock().toISOString().slice(0, 10);

  const [user, todaysLog, lastWorkout, latestMeasurement, evaluation, nextRoutine] =
    await Promise.all([
      repos.users.findById(userId),
      repos.foodLog.listByDate(userId, today),
      repos.workoutLogs.findLatest(userId),
      repos.bodyMeasurements.findLatest(userId),
      repos.evaluations.findLatest(userId),
      pickNextRoutine(repos, userId),
    ]);

  const totals = totalsFor(today, todaysLog);
  const goals = (user?.goals ?? undefined) as Goals | undefined;
  const targetCalories = goals?.targetCalories;
  const targetProteinG = goals?.targetProteinG;

  // The trend is only computed when there is a measurement to anchor it, so a new
  // user's overview does not pay for arithmetic that will return insufficient-data.
  const trend = latestMeasurement ? await getTrend(deps, userId, TREND_WINDOW_DAYS) : undefined;

  return {
    date: today,
    calories: {
      logged: Math.round(totals.calories),
      ...(targetCalories !== undefined
        ? {
            target: targetCalories,
            // Allowed to go negative: a user over their target should see by how much.
            remaining: Math.round(targetCalories - totals.calories),
          }
        : {}),
    },
    macros: {
      proteinG: Math.round(totals.proteinG),
      carbsG: Math.round(totals.carbsG),
      fatG: Math.round(totals.fatG),
      ...(targetProteinG !== undefined ? { proteinTargetG: targetProteinG } : {}),
    },
    ...(nextRoutine ? { nextRoutine } : {}),
    ...(lastWorkout
      ? {
          lastWorkout: {
            id: lastWorkout.id,
            routineName: lastWorkout.routineName,
            completedAt: lastWorkout.completedAt,
          },
        }
      : {}),
    ...(latestMeasurement
      ? {
          bodyComposition: {
            latestWeightKg: latestMeasurement.weightKg,
            latestDate: latestMeasurement.date,
            ...(trend?.status === 'ok'
              ? {
                  weightChangeKg: trend.weightChangeKg,
                  ratePerWeekKg: trend.ratePerWeekKg,
                  direction: trend.direction,
                }
              : {}),
          },
        }
      : {}),
    evaluation: { status: evaluation?.status ?? 'none' },
    // Filled in by the client from its outbox; the server has no view of it.
    pendingSyncCount: 0,
  };
}
