/**
 * Every tab renders.
 *
 * The gap this closes: until now the only frontend tests covered the offline
 * queue and the onboarding flow, so no test had ever mounted Overview, Training,
 * Nutrition, Body or Settings. A crash on first paint in any of them — a
 * `.map` over an absent array, a field read off an optional object — would have
 * shipped with a green suite behind it.
 *
 * These are deliberately shallow assertions. The point is not to re-test each
 * feature's behaviour but to prove each screen survives mount, and survives it
 * three ways, because those fail differently:
 *
 *   - with a full payload, where every optional field is present
 *   - with the emptiest payload the wire types permit, which is what a brand new
 *     account actually returns
 *   - with the request failing, which is what a phone on a bad connection sees
 *
 * The second case is the one that finds bugs: the server omits optional fields
 * rather than sending nulls, so a new user's Overview has no `nextRoutine`, no
 * `lastWorkout` and no `bodyComposition` at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  BodyCompEvaluation,
  BodyMeasurement,
  CustomFood,
  Exercise,
  FoodLogEntry,
  OverviewSummary,
  Routine,
  TrendResult,
  WorkoutLog,
} from '@app/shared-types';
import { SESSION, makeUser, renderApp } from './helpers/render';
import type { StubRoute } from './helpers/render';

const ONBOARDED = makeUser({
  onboarding: { goalsSubmitted: true, startingStatsSubmitted: true, complete: true },
  goals: { goal: 'cut', targetCalories: 2100, targetProteinG: 160, targetRateKgPerWeek: -0.5 },
});

// --- Full payloads: every optional field present ----------------------------

const FULL_OVERVIEW: OverviewSummary = {
  date: '2026-09-16',
  calories: { logged: 1450, target: 2100, remaining: 650 },
  macros: { proteinG: 120, carbsG: 140, fatG: 45, proteinTargetG: 160 },
  nextRoutine: { id: 'routine-1', name: 'Upper A', exerciseCount: 5 },
  lastWorkout: {
    id: 'log-1',
    routineName: 'Lower B',
    completedAt: '2026-09-15T18:00:00.000Z',
  },
  bodyComposition: {
    latestWeightKg: 82.4,
    latestDate: '2026-09-16',
    weightChangeKg: -1.2,
    ratePerWeekKg: -0.4,
    direction: 'losing',
  },
  evaluation: { status: 'ready' },
  pendingSyncCount: 0,
};

const FULL_TREND: TrendResult = {
  status: 'ok',
  fromDate: '2026-08-17',
  toDate: '2026-09-16',
  days: 30,
  startWeightKg: 83.6,
  endWeightKg: 82.4,
  weightChangeKg: -1.2,
  ratePerWeekKg: -0.28,
  direction: 'losing',
  avgDailyCalories: 2050,
  avgDailyProteinG: 155,
  daysWithFoodLogs: 24,
  estimatedMaintenanceCalories: 2400,
  recommendation: {
    action: 'hold-calories',
    secondaryActions: [],
    calorieDeltaPerDay: 0,
    proteinTargetG: 160,
    rationale: 'Losing at close to the target rate. Keep intake where it is.',
  },
};

const EXERCISES: Exercise[] = [
  {
    id: 'ex-1',
    name: 'Barbell Bench Press',
    muscleGroup: 'chest',
    secondaryMuscles: ['shoulders', 'triceps'],
    category: 'strength',
    level: 'intermediate',
    equipment: 'barbell',
    mediaUrl: 'https://example.test/bench.jpg',
    instructions: ['Lie on the bench.', 'Press the bar up.'],
  },
];

const ROUTINES: Routine[] = [
  {
    id: 'routine-1',
    name: 'Upper A',
    exercises: [
      {
        exerciseId: 'ex-1',
        exerciseName: 'Barbell Bench Press',
        sets: 3,
        targetReps: 8,
        targetWeightKg: 60,
        restSeconds: 120,
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
];

const WORKOUT_LOGS: WorkoutLog[] = [
  {
    id: 'log-1',
    clientId: 'client-log-1',
    routineId: 'routine-1',
    routineName: 'Upper A',
    completedAt: '2026-09-15T18:00:00.000Z',
    durationSeconds: 3300,
    performed: [
      {
        exerciseId: 'ex-1',
        exerciseName: 'Barbell Bench Press',
        sets: [
          { reps: 8, weightKg: 60 },
          { reps: 8, weightKg: 60 },
          { reps: 6, weightKg: 60, skipped: false },
        ],
      },
    ],
    createdAt: '2026-09-15T18:01:00.000Z',
  },
];

const FOOD_LOG: FoodLogEntry[] = [
  {
    id: 'entry-1',
    clientId: 'client-entry-1',
    date: '2026-09-16',
    foodItemId: 'custom:food-1',
    foodName: 'Greek Yogurt',
    source: 'custom',
    servingLabel: '170 g pot',
    servingMultiplier: 1,
    baseCalories: 100,
    baseProteinG: 17,
    baseCarbsG: 6,
    baseFatG: 0,
    calories: 100,
    proteinG: 17,
    carbsG: 6,
    fatG: 0,
    meal: 'breakfast',
    loggedAt: '2026-09-16T07:30:00.000Z',
  },
];

const CUSTOM_FOODS: CustomFood[] = [
  {
    id: 'food-1',
    clientId: 'client-food-1',
    name: 'Greek Yogurt',
    servingLabel: '170 g pot',
    calories: 100,
    proteinG: 17,
    carbsG: 6,
    fatG: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

const MEASUREMENTS: BodyMeasurement[] = [
  {
    id: 'bm-1',
    clientId: 'client-bm-1',
    date: '2026-09-16',
    weightKg: 82.4,
    bodyFatPct: 18.2,
    tapeCm: { waist: 84, chest: 103 },
    createdAt: '2026-09-16T06:00:00.000Z',
  },
  {
    id: 'bm-2',
    clientId: 'client-bm-2',
    date: '2026-08-17',
    weightKg: 83.6,
    createdAt: '2026-08-17T06:00:00.000Z',
  },
];

const EVALUATION: BodyCompEvaluation = {
  status: 'ready',
  measurementId: 'bm-1',
  trend: FULL_TREND,
  summary: 'Down 1.2 kg over the month — close to your target rate.',
  createdAt: '2026-09-16T06:00:10.000Z',
  completedAt: '2026-09-16T06:00:14.000Z',
};

/** The profile call every screen sits behind. */
const ME: StubRoute = { match: '/api/users/me', method: 'GET', response: ONBOARDED };

function fullRoutes(): StubRoute[] {
  return [
    ME,
    { match: '/api/overview', response: FULL_OVERVIEW },
    { match: '/api/exercises', response: EXERCISES },
    { match: '/api/routines', method: 'GET', response: ROUTINES },
    { match: '/api/workout-logs', method: 'GET', response: WORKOUT_LOGS },
    { match: '/api/nutrition/log', method: 'GET', response: FOOD_LOG },
    { match: '/api/nutrition/custom-foods', method: 'GET', response: CUSTOM_FOODS },
    { match: '/api/body-composition/evaluation', response: EVALUATION },
    { match: '/api/body-composition/trend', response: FULL_TREND },
    { match: '/api/body-composition', method: 'GET', response: MEASUREMENTS },
    { match: '/api/billing/status', response: { plan: 'free', isPremium: false } },
    {
      match: '/api/billing/premium-teaser',
      response: { title: 'Full Health Premium', subtitle: 'Coming soon', features: ['Coaching'] },
    },
  ];
}

/**
 * The emptiest responses the wire types allow — a brand new account.
 *
 * Note what is NOT here: `nextRoutine`, `lastWorkout` and `bodyComposition` are
 * absent rather than null, which is what the server actually sends, and every
 * list is empty rather than containing a placeholder row.
 */
function emptyRoutes(): StubRoute[] {
  const emptyOverview: OverviewSummary = {
    date: '2026-09-16',
    calories: { logged: 0 },
    macros: { proteinG: 0, carbsG: 0, fatG: 0 },
    evaluation: { status: 'none' },
    pendingSyncCount: 0,
  };
  const insufficient: TrendResult = {
    status: 'insufficient-data',
    reasons: ['not-enough-weight-entries', 'span-too-short'],
    daysNeeded: 14,
    weightEntryCount: 0,
    daysWithFoodLogs: 0,
  };

  return [
    ME,
    { match: '/api/overview', response: emptyOverview },
    { match: '/api/exercises', response: [] },
    { match: '/api/routines', method: 'GET', response: [] },
    { match: '/api/workout-logs', method: 'GET', response: [] },
    { match: '/api/nutrition/log', method: 'GET', response: [] },
    { match: '/api/nutrition/custom-foods', method: 'GET', response: [] },
    { match: '/api/body-composition/evaluation', response: { status: 'none' } },
    { match: '/api/body-composition/trend', response: insufficient },
    { match: '/api/body-composition', method: 'GET', response: [] },
    { match: '/api/billing/status', response: { plan: 'free', isPremium: false } },
    {
      match: '/api/billing/premium-teaser',
      response: { title: 'Full Health Premium', subtitle: 'Coming soon', features: [] },
    },
  ];
}

/** Everything past the profile call fails, as it would with the API down. */
function failingRoutes(): StubRoute[] {
  return [
    ME,
    {
      match: '/api/',
      response: { error: { code: 'INTERNAL', message: 'Upstream is down.' } },
      status: 500,
    },
  ];
}

const TABS = [
  { path: '/app/overview', name: 'Overview' },
  { path: '/app/training', name: 'Training' },
  { path: '/app/nutrition', name: 'Nutrition' },
  { path: '/app/body', name: 'Body' },
  { path: '/app/settings', name: 'Settings' },
] as const;

/**
 * Fails the test on any render error.
 *
 * React reports a caught render error through console.error rather than by
 * rejecting, so without this a component that throws and gets swallowed by a
 * boundary would still count as a pass.
 */
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function expectNoRenderErrors(): void {
  expect(consoleErrors).toEqual([]);
}

/** Waits for the tab bar, which only mounts once the router has settled. */
async function waitForShell(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('navigation', { name: 'Main' }));
}

describe.each([
  { label: 'a full payload', routes: fullRoutes },
  { label: 'an empty account', routes: emptyRoutes },
  { label: 'a failing API', routes: failingRoutes },
])('each tab renders with $label', ({ routes }) => {
  it.each(TABS)('renders $name', async ({ path, name }) => {
    renderApp({ session: SESSION, routes: routes(), initialPath: path });

    const nav = await waitForShell();

    // The tab is present and marked current, so the route resolved rather than
    // redirecting somewhere else.
    const link = within(nav).getByRole('link', { name: new RegExp(name, 'i') });
    await waitFor(() => expect(link).toHaveAttribute('aria-current', 'page'));

    // Something rendered above the nav. A crashed screen leaves the boundary's
    // alert or nothing at all.
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.queryByText('Something broke')).not.toBeInTheDocument();

    expectNoRenderErrors();
  });
});

describe('each tab shows the data it was given', () => {
  /**
   * Separate from the mount checks above, which only prove a screen survives.
   * A screen that fetched its data and then rendered an empty state anyway would
   * pass those and fail these.
   */
  it.each([
    { path: '/app/overview', expected: [/1450/, /Upper A/, /82\.4/] },
    { path: '/app/training', expected: [/Upper A/] },
    { path: '/app/nutrition', expected: [/Greek Yogurt/] },
    { path: '/app/body', expected: [/82\.4/] },
    { path: '/app/settings', expected: [/a@example\.com/i] },
  ])('shows its own content on $path', async ({ path, expected }) => {
    renderApp({ session: SESSION, routes: fullRoutes(), initialPath: path });
    await waitForShell();

    for (const pattern of expected) {
      // getAllBy: a value can legitimately appear twice, e.g. the latest weight
      // both in the summary and in the measurement list beneath it.
      await waitFor(() =>
        expect(screen.getAllByText(pattern, { exact: false })).not.toHaveLength(0),
      );
    }
    expectNoRenderErrors();
  });
});

describe('the tab bar navigates', () => {
  it('moves between all five tabs without a crash', async () => {
    const user = userEvent.setup();
    renderApp({ session: SESSION, routes: fullRoutes(), initialPath: '/app/overview' });

    const nav = await waitForShell();

    for (const tab of TABS) {
      await user.click(within(nav).getByRole('link', { name: new RegExp(tab.name, 'i') }));
      await waitFor(() =>
        expect(within(nav).getByRole('link', { name: new RegExp(tab.name, 'i') })).toHaveAttribute(
          'aria-current',
          'page',
        ),
      );
      expect(screen.queryByText('Something broke')).not.toBeInTheDocument();
    }

    expectNoRenderErrors();
  });

  it('sends a bare /app to the overview tab', async () => {
    renderApp({ session: SESSION, routes: fullRoutes(), initialPath: '/app' });

    const nav = await waitForShell();
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: /Overview/i })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expectNoRenderErrors();
  });

  it('sends a stale onboarding URL to the overview tab', async () => {
    // Someone who finished onboarding and still has the signup page bookmarked.
    renderApp({ session: SESSION, routes: fullRoutes(), initialPath: '/onboarding/signup' });

    const nav = await waitForShell();
    await waitFor(() =>
      expect(within(nav).getByRole('link', { name: /Overview/i })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
    expectNoRenderErrors();
  });
});
