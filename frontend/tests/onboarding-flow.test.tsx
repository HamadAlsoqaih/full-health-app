/**
 * The onboarding decision tree, end to end.
 *
 * This is the flow the spec says to get right before anything else, and its
 * hardest requirement is resume: the app may be closed at any point, including
 * after the account exists but before both post-signup writes have landed.
 *
 * These tests drive the real AppRouter and the real screens, so what is asserted
 * is the actual routing logic rather than a restatement of it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SESSION, makeUser, renderApp, type StubRoute } from './helpers/render';

/** Routes for the happy signup path. */
function signupRoutes(): StubRoute[] {
  // Progress advances as the writes land, exactly as the server would report it.
  const progress = { goalsSubmitted: false, startingStatsSubmitted: false, complete: false };

  return [
    {
      match: '/api/auth/register',
      method: 'POST',
      status: 201,
      response: () => ({ user: makeUser(), session: SESSION }),
    },
    {
      match: '/api/users/me/onboarding',
      method: 'POST',
      response: () => {
        progress.goalsSubmitted = true;
        return makeUser({ onboarding: { ...progress } });
      },
    },
    {
      match: '/api/body-composition/entry',
      method: 'POST',
      status: 201,
      response: () => {
        progress.startingStatsSubmitted = true;
        progress.complete = progress.goalsSubmitted;
        return { id: 'bm-1', clientId: 'c-1', date: '2026-03-01', weightKg: 88.4, createdAt: '' };
      },
    },
    {
      match: '/api/users/me',
      method: 'GET',
      response: () => makeUser({ onboarding: { ...progress } }),
    },
    {
      match: '/api/overview',
      response: {
        date: '2026-03-01',
        calories: { logged: 0 },
        macros: { proteinG: 0, carbsG: 0, fatG: 0 },
        evaluation: { status: 'none' },
        pendingSyncCount: 0,
      },
    },
  ];
}

beforeEach(() => {
  localStorage.clear();
});

describe('signed out', () => {
  it('lands on the welcome screen, not a signup form', async () => {
    renderApp();

    // The whole point of the ordering: no account is asked for up front.
    expect(await screen.findByText(/train, eat, and see what changes/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get started/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('offers the escape hatch for a returning user', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: /already have an account/i }));

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
  });

  it('can reach login directly by URL', async () => {
    renderApp({ initialPath: '/login' });
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });

  it('redirects an unknown path to the welcome screen', async () => {
    renderApp({ initialPath: '/app/overview' });
    expect(await screen.findByText(/train, eat, and see what changes/i)).toBeInTheDocument();
  });
});

describe('the full onboarding path', () => {
  it('walks welcome → goals → stats → dietary → signup, then submits the held answers', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp({ routes: signupRoutes() });

    // Step 1
    await user.click(await screen.findByRole('button', { name: /get started/i }));

    // Step 2: goals
    expect(
      await screen.findByRole('heading', { name: /what are you working towards/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /build muscle/i }));
    await user.type(screen.getByLabelText(/daily calorie target/i), '2800');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // Step 3: stats. Weight is the only required field.
    expect(
      await screen.findByRole('heading', { name: /where are you starting from/i }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/current weight/i), '88.4');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // Step 4: dietary preferences
    expect(
      await screen.findByRole('heading', { name: /anything we should know/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /halal/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    // Step 5: account creation, LAST.
    expect(await screen.findByRole('heading', { name: /save your setup/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/api/users/me/onboarding'))).toBe(true);
    });
    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/api/body-composition/entry'))).toBe(true);
    });

    // Registration precedes both writes: there is no user to attach them to before.
    const order = requests.filter((r) => r.method === 'POST').map((r) => r.url);
    expect(order[0]).toContain('/api/auth/register');

    const goals = requests.find((r) => r.url.includes('/api/users/me/onboarding'))?.body as {
      goals: { goal: string; targetCalories: number; dietaryPrefs: { preferences: string[] } };
    };
    expect(goals.goals.goal).toBe('bulk');
    expect(goals.goals.targetCalories).toBe(2800);
    // Dietary preferences ride inside goals; they have no endpoint of their own.
    expect(goals.goals.dietaryPrefs.preferences).toContain('Halal');

    const stats = requests.find((r) => r.url.includes('/api/body-composition/entry'))?.body as {
      weightKg: number;
      clientId: string;
    };
    expect(stats.weightKg).toBe(88.4);
    // A client-minted idempotency key, so a retried submit cannot duplicate.
    expect(stats.clientId.length).toBeGreaterThanOrEqual(8);
  });

  it('converts imperial entry to metric before it leaves the device', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp({ routes: signupRoutes() });

    await user.click(await screen.findByRole('button', { name: /get started/i }));
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));

    await screen.findByRole('heading', { name: /where are you starting from/i });
    await user.selectOptions(screen.getByLabelText(/units/i), 'imperial');
    await user.type(screen.getByLabelText(/current weight/i), '195');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await user.click(await screen.findByRole('button', { name: /skip this step/i }));

    await screen.findByRole('heading', { name: /save your setup/i });
    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/api/body-composition/entry'))).toBe(true);
    });

    const stats = requests.find((r) => r.url.includes('/api/body-composition/entry'))?.body as {
      weightKg: number;
    };
    // 195 lb is 88.45 kg. A kg column holding pounds is unrecoverable.
    expect(stats.weightKg).toBeCloseTo(88.45, 1);
  });

  it('records an explicit skip rather than an empty answer', async () => {
    const user = userEvent.setup();
    const { requests } = renderApp({ routes: signupRoutes() });

    await user.click(await screen.findByRole('button', { name: /get started/i }));
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /where are you starting from/i });
    await user.type(screen.getByLabelText(/current weight/i), '88');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));

    await user.click(await screen.findByRole('button', { name: /skip this step/i }));
    await screen.findByRole('heading', { name: /save your setup/i });
    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/api/users/me/onboarding'))).toBe(true);
    });

    const goals = requests.find((r) => r.url.includes('/api/users/me/onboarding'))?.body as {
      goals: { dietaryPrefs: { skipped: boolean } };
    };
    // "Asked and declined" is different information from "never asked".
    expect(goals.goals.dietaryPrefs.skipped).toBe(true);
  });

  it('validates the weight field rather than sending nonsense', async () => {
    const user = userEvent.setup();
    renderApp({ routes: signupRoutes() });

    await user.click(await screen.findByRole('button', { name: /get started/i }));
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /where are you starting from/i });

    // Empty
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/enter your current weight/i)).toBeInTheDocument();

    // Implausible
    await user.type(screen.getByLabelText(/current weight/i), '900');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/plausible weight/i)).toBeInTheDocument();
  });
});

describe('draft persistence', () => {
  it('keeps answers on disk, so closing the app mid-onboarding does not lose them', async () => {
    const user = userEvent.setup();
    const first = renderApp({ routes: signupRoutes() });

    await user.click(await screen.findByRole('button', { name: /get started/i }));
    await user.click(screen.getByRole('radio', { name: /maintain/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /where are you starting from/i });
    await user.type(screen.getByLabelText(/current weight/i), '77.5');
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByRole('heading', { name: /anything we should know/i });

    // In-memory React state would be gone here; localStorage is not.
    const stored = localStorage.getItem('fha.onboarding.draft.v1');
    expect(stored).toBeTruthy();
    const draft = JSON.parse(stored as string) as {
      goals: { goal: string };
      stats: { weightKg: number };
      statsClientId: string;
    };
    expect(draft.goals.goal).toBe('maintain');
    expect(draft.stats.weightKg).toBe(77.5);
    // Minted at capture time, which is what makes a retried submit idempotent.
    expect(draft.statsClientId).toBeTruthy();

    first.unmount();

    // Reopening prefills rather than starting over.
    renderApp({ routes: signupRoutes(), initialPath: '/onboarding/goals' });
    expect(await screen.findByRole('radio', { name: /maintain/i })).toBeChecked();
  });
});

describe('resume after the app was closed mid-submit', () => {
  it('auto-submits the outstanding stats write and shows a spinner, not a form', async () => {
    // The state being reproduced: account created, goals landed, app closed before
    // the stats write, draft still on disk.
    localStorage.setItem(
      'fha.onboarding.draft.v1',
      JSON.stringify({
        v: 1,
        goals: { goal: 'cut', targetCalories: 2100 },
        stats: { weightKg: 91.2 },
        statsClientId: 'resume-client-id-1',
        submitted: { goals: true, stats: false },
        updatedAt: new Date().toISOString(),
      }),
    );

    const progress = { goalsSubmitted: true, startingStatsSubmitted: false, complete: false };
    const { requests } = renderApp({
      session: SESSION,
      routes: [
        {
          match: '/api/body-composition/entry',
          method: 'POST',
          status: 201,
          response: () => {
            progress.startingStatsSubmitted = true;
            progress.complete = true;
            return {
              id: 'bm-1',
              clientId: 'resume-client-id-1',
              date: '2026-03-01',
              weightKg: 91.2,
              createdAt: '',
            };
          },
        },
        {
          match: '/api/users/me',
          method: 'GET',
          response: () => makeUser({ onboarding: { ...progress } }),
        },
        {
          match: '/api/overview',
          response: {
            date: '2026-03-01',
            calories: { logged: 0 },
            macros: { proteinG: 0, carbsG: 0, fatG: 0 },
            evaluation: { status: 'none' },
            pendingSyncCount: 0,
          },
        },
      ],
    });

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/api/body-composition/entry'))).toBe(true);
    });

    const entry = requests.find((r) => r.url.includes('/api/body-composition/entry'))?.body as {
      weightKg: number;
      clientId: string;
    };
    expect(entry.weightKg).toBe(91.2);
    // The SAME key as the interrupted attempt, so the server dedupes rather than
    // writing a second measurement.
    expect(entry.clientId).toBe('resume-client-id-1');

    // The user was never asked to retype the weight.
    expect(screen.queryByLabelText(/current weight/i)).not.toBeInTheDocument();

    // And once both writes have landed, the tabs appear.
    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument();
  });

  it('does not resubmit goals that already landed', async () => {
    localStorage.setItem(
      'fha.onboarding.draft.v1',
      JSON.stringify({
        v: 1,
        goals: { goal: 'cut' },
        stats: { weightKg: 91.2 },
        statsClientId: 'resume-client-id-2',
        submitted: { goals: true, stats: false },
        updatedAt: new Date().toISOString(),
      }),
    );

    const { requests } = renderApp({
      session: SESSION,
      routes: [
        { match: '/api/body-composition/entry', method: 'POST', status: 201, response: {} },
        {
          match: '/api/users/me',
          method: 'GET',
          response: makeUser({
            onboarding: { goalsSubmitted: true, startingStatsSubmitted: false, complete: false },
          }),
        },
      ],
    });

    await waitFor(() => {
      expect(requests.some((r) => r.url.includes('/api/body-composition/entry'))).toBe(true);
    });
    expect(requests.some((r) => r.url.includes('/api/users/me/onboarding'))).toBe(false);
  });

  it('asks for the missing answer when no draft survived, e.g. on another device', async () => {
    // No localStorage draft: a different browser entirely.
    renderApp({
      session: SESSION,
      routes: [
        {
          match: '/api/users/me',
          method: 'GET',
          response: makeUser({
            onboarding: { goalsSubmitted: true, startingStatsSubmitted: false, complete: false },
          }),
        },
      ],
    });

    // Falls back to the form for exactly the outstanding step rather than crashing
    // or restarting the whole questionnaire.
    expect(
      await screen.findByRole('heading', { name: /where are you starting from/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /what are you working towards/i }),
    ).not.toBeInTheDocument();
  });

  it('asks for goals when those are what is outstanding', async () => {
    renderApp({
      session: SESSION,
      routes: [
        {
          match: '/api/users/me',
          method: 'GET',
          response: makeUser({
            onboarding: { goalsSubmitted: false, startingStatsSubmitted: false, complete: false },
          }),
        },
      ],
    });

    expect(
      await screen.findByRole('heading', { name: /what are you working towards/i }),
    ).toBeInTheDocument();
  });
});

describe('fully onboarded', () => {
  const onboardedRoutes: StubRoute[] = [
    {
      match: '/api/users/me',
      method: 'GET',
      response: makeUser({
        onboarding: { goalsSubmitted: true, startingStatsSubmitted: true, complete: true },
      }),
    },
    {
      match: '/api/overview',
      response: {
        date: '2026-03-01',
        calories: { logged: 1200, target: 2000, remaining: 800 },
        macros: { proteinG: 100, carbsG: 120, fatG: 40 },
        evaluation: { status: 'none' },
        pendingSyncCount: 0,
      },
    },
  ];

  it('goes straight to the five tabs', async () => {
    renderApp({ session: SESSION, routes: onboardedRoutes });

    const nav = await screen.findByRole('navigation', { name: /main/i });
    expect(nav).toBeInTheDocument();

    // Exactly five tabs, in the documented order. Queried as links, not by
    // role="tab": these navigate between routes rather than switching panels, so
    // the bar is a labelled <nav> of links carrying aria-current — see BottomNav.
    const tabs = await within(nav).findAllByRole('link');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Overview'),
      expect.stringContaining('Training'),
      expect.stringContaining('Nutrition'),
      expect.stringContaining('Body'),
      expect.stringContaining('Settings'),
    ]);
  });

  it('never shows onboarding again, even if that URL is requested', async () => {
    renderApp({ session: SESSION, routes: onboardedRoutes, initialPath: '/onboarding/goals' });

    expect(await screen.findByRole('navigation', { name: /main/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /what are you working towards/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the overview from the single aggregated endpoint', async () => {
    const { requests } = renderApp({ session: SESSION, routes: onboardedRoutes });

    expect(await screen.findByText('1200')).toBeInTheDocument();
    expect(screen.getByText(/800 left/i)).toBeInTheDocument();

    // Rule 5: one call, not one per feature.
    const featureCalls = requests.filter(
      (r) =>
        r.url.includes('/api/routines') ||
        r.url.includes('/api/workout-logs') ||
        r.url.includes('/api/nutrition/log') ||
        r.url.includes('/api/body-composition'),
    );
    expect(featureCalls).toHaveLength(0);
  });
});

describe('a session the server rejects', () => {
  it('returns the user to login rather than a broken screen', async () => {
    renderApp({
      session: SESSION,
      routes: [
        {
          match: '/api/users/me',
          method: 'GET',
          status: 401,
          response: { error: { code: 'UNAUTHENTICATED', message: 'Session expired.' } },
        },
        {
          match: '/api/auth/refresh',
          method: 'POST',
          status: 401,
          response: { error: { code: 'UNAUTHENTICATED', message: 'Refresh failed.' } },
        },
      ],
    });

    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});
