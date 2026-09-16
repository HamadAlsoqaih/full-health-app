/**
 * Running a routine, end to end through the real Training tab.
 *
 * RoutinePlayer is the most stateful component in the app — a grid of per-set
 * reps, weight and done flags that becomes one POST body — and it had no test
 * at all. What is asserted here is the shape of that body, because it is the
 * thing a training log exists for: "you did Push A on Tuesday" is nearly
 * useless, the weight on the bar is what shows progress.
 *
 * Driven through TrainingTab rather than by mounting RoutinePlayer with a fake
 * mutation, so the routine list, the hand-off into the player and the mutation
 * wiring are all real. Only the network is stubbed.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Routine, WorkoutLog } from '@app/shared-types';
import { SESSION, makeUser, renderApp } from './helpers/render';
import type { StubRoute } from './helpers/render';

const ONBOARDED = makeUser({
  onboarding: { goalsSubmitted: true, startingStatsSubmitted: true, complete: true },
});

const ROUTINE: Routine = {
  id: 'routine-1',
  name: 'Upper A',
  exercises: [
    {
      exerciseId: 'ex-1',
      exerciseName: 'Barbell Bench Press',
      sets: 2,
      targetReps: 8,
      targetWeightKg: 60,
    },
    {
      exerciseId: 'ex-2',
      exerciseName: 'Pull-Up',
      sets: 1,
      targetReps: 6,
      // No target weight: bodyweight. The field must come through empty, not 0.
    },
  ],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const LOGGED: WorkoutLog = {
  id: 'log-1',
  clientId: 'client-1',
  routineId: 'routine-1',
  routineName: 'Upper A',
  completedAt: '2026-09-16T18:00:00.000Z',
  performed: [],
  createdAt: '2026-09-16T18:00:00.000Z',
};

function routes(): StubRoute[] {
  return [
    { match: '/api/users/me', method: 'GET', response: ONBOARDED },
    { match: '/api/routines', method: 'GET', response: [ROUTINE] },
    { match: '/api/workout-logs', method: 'GET', response: [] },
    { match: '/api/workout-logs', method: 'POST', status: 201, response: LOGGED },
    { match: '/api/exercises', response: [] },
    { match: '/api/overview', response: { calories: {}, macros: {} } },
  ];
}

/** Opens the player for the seeded routine. */
async function startWorkout() {
  const user = userEvent.setup();
  const rendered = renderApp({ session: SESSION, routes: routes(), initialPath: '/app/training' });

  await user.click(await screen.findByRole('button', { name: 'Start' }));
  // The player takes over the screen, so the routine name becomes the heading.
  await screen.findByRole('heading', { level: 1, name: 'Upper A' });

  return { user, ...rendered };
}

/** The set rows, in document order: bench set 1, bench set 2, pull-up set 1. */
function setToggles(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /Mark set \d+ of/ });
}

describe('running a routine', () => {
  it('pre-fills reps and weight from the routine targets', async () => {
    await startWorkout();

    const reps = screen.getAllByLabelText('Reps');
    expect(reps.map((input) => (input as HTMLInputElement).value)).toEqual(['8', '8', '6']);

    const weights = screen.getAllByLabelText('kg');
    // Empty for the bodyweight exercise, not a fabricated zero.
    expect(weights.map((input) => (input as HTMLInputElement).value)).toEqual(['60', '60', '']);
  });

  it('counts ticked sets and reports progress', async () => {
    const { user } = await startWorkout();

    expect(screen.getByText('0 of 3 sets done')).toBeInTheDocument();

    await user.click(setToggles()[0]!);
    expect(await screen.findByText('1 of 3 sets done')).toBeInTheDocument();

    // Tapping again unticks it, rather than being one-way.
    await user.click(setToggles()[0]!);
    expect(await screen.findByText('0 of 3 sets done')).toBeInTheDocument();
  });

  it('posts what was actually performed, marking untouched sets skipped', async () => {
    const { user, requests } = await startWorkout();

    // Two sets done, the second at a heavier weight and fewer reps than planned.
    await user.click(setToggles()[0]!);

    const reps = screen.getAllByLabelText('Reps');
    const weights = screen.getAllByLabelText('kg');
    await user.clear(reps[1]!);
    await user.type(reps[1]!, '6');
    await user.clear(weights[1]!);
    await user.type(weights[1]!, '62.5');
    await user.click(setToggles()[1]!);

    // The pull-up set is left untouched on purpose.
    await user.click(screen.getByRole('button', { name: 'Finish workout' }));

    await waitFor(() => {
      expect(requests.some((r) => r.method === 'POST' && r.url.includes('/api/workout-logs'))).toBe(
        true,
      );
    });

    const post = requests.find((r) => r.method === 'POST' && r.url.includes('/api/workout-logs'))!;
    const body = post.body as {
      clientId: string;
      routineId: string;
      routineName: string;
      performed: Array<{
        exerciseId: string;
        exerciseName: string;
        sets: Array<{ reps: number; weightKg?: number; skipped?: boolean }>;
      }>;
    };

    expect(body.routineId).toBe('routine-1');
    expect(body.routineName).toBe('Upper A');
    // Minted client-side so the write and any offline retry share one
    // idempotency key.
    expect(body.clientId).toMatch(/\S/);

    expect(body.performed).toEqual([
      {
        exerciseId: 'ex-1',
        exerciseName: 'Barbell Bench Press',
        sets: [
          { reps: 8, weightKg: 60 },
          { reps: 6, weightKg: 62.5 },
        ],
      },
      {
        exerciseId: 'ex-2',
        exerciseName: 'Pull-Up',
        // Never ticked: recorded as skipped rather than dropped, and with no
        // weight key at all for a bodyweight exercise.
        sets: [{ reps: 6, skipped: true }],
      },
    ]);
  });

  it('returns to the routine list once logged', async () => {
    const { user } = await startWorkout();

    await user.click(setToggles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Finish workout' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Training' })).toBeInTheDocument();
  });
});

describe('discarding a workout', () => {
  it('asks first once sets have been ticked', async () => {
    const { user, requests } = await startWorkout();

    await user.click(setToggles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Discard' }));

    // Still in the player, now asking.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/1 of 3 sets are ticked off/);
    expect(screen.queryByRole('heading', { level: 1, name: 'Training' })).not.toBeInTheDocument();
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('keeps the entered sets when the confirmation is declined', async () => {
    const { user } = await startWorkout();

    await user.click(setToggles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(await screen.findByRole('button', { name: 'Keep going' }));

    expect(await screen.findByText('1 of 3 sets done')).toBeInTheDocument();
  });

  it('leaves the player when the confirmation is accepted', async () => {
    const { user, requests } = await startWorkout();

    await user.click(setToggles()[0]!);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('alertdialog');
    await within(dialog).findByRole('button', { name: 'Discard' });
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Training' })).toBeInTheDocument();
    // Discarding must not log anything.
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('does not ask when nothing has been ticked yet', async () => {
    // Nothing to lose, so the confirmation would only be friction.
    const { user } = await startWorkout();

    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Training' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
