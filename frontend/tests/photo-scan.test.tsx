/**
 * The photo scan, and specifically: a failure must not cost you the photo.
 *
 * What prompted this: Google returned 503 — "this model is currently
 * experiencing high demand" — and the only way forward was a Retry button that
 * reopened the file picker. Someone who had just photographed their lunch had to
 * go and find that photo again, because of a problem on Google's side that
 * lasted seconds.
 *
 * The file is already in the page. Asking for it twice was never necessary.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhotoScanResult } from '@app/shared-types';
import { SESSION, makeUser, renderApp } from './helpers/render';
import type { StubRoute } from './helpers/render';

const ONBOARDED = makeUser({
  onboarding: { goalsSubmitted: true, startingStatsSubmitted: true, complete: true },
});

const ESTIMATE: PhotoScanResult = {
  estimate: {
    id: 'estimate:abc',
    name: 'Grilled chicken with rice',
    source: 'ai-photo-estimate',
    servingLabel: '1 plate',
    calories: 620,
    proteinG: 48,
    carbsG: 62,
    fatG: 18,
  },
  confidence: 'medium',
  detectedItems: ['grilled chicken', 'white rice'],
  autoLogged: false,
};

/** Google's real 503, as the API relays it. */
const BUSY = {
  match: '/api/nutrition/scan-photo',
  method: 'POST',
  status: 503,
  response: {
    error: { code: 'AI_UNAVAILABLE', message: 'Could not analyse that photo right now.' },
  },
} as const;

function baseRoutes(): StubRoute[] {
  return [
    { match: '/api/users/me', method: 'GET', response: ONBOARDED },
    { match: '/api/nutrition/log', method: 'GET', response: [] },
    { match: '/api/nutrition/custom-foods', method: 'GET', response: [] },
    {
      match: '/api/overview',
      response: {
        date: '2026-09-17',
        calories: { logged: 0 },
        macros: { proteinG: 0, carbsG: 0, fatG: 0 },
        evaluation: { status: 'none' },
        pendingSyncCount: 0,
      },
    },
  ];
}

/** A real File, so the component's size check and preview behave normally. */
function photo(name = 'lunch.jpg'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/jpeg' });
}

/** Opens the Nutrition tab's scan view and uploads a photo. */
async function scanWith(routes: StubRoute[]) {
  const user = userEvent.setup();
  const rendered = renderApp({ session: SESSION, routes, initialPath: '/app/nutrition' });

  await user.click(await screen.findByRole('button', { name: /scan a meal|photo/i }));

  const input = await waitFor(() => {
    const found = document.querySelector('input[type="file"]');
    if (!found) throw new Error('no file input');
    return found as HTMLInputElement;
  });

  await user.upload(input, photo());
  return { user, input, ...rendered };
}

describe('a scan that fails because the provider is busy', () => {
  it('keeps the photo on screen instead of discarding it', async () => {
    await scanWith([...baseRoutes(), BUSY]);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    // The preview is still there — the photo was not thrown away with the error.
    expect(screen.getByAltText(/meal you photographed/i)).toBeInTheDocument();
  });

  it('re-sends the same photo on Retry, without asking for it again', async () => {
    const { user, requests } = await scanWith([...baseRoutes(), BUSY]);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    const before = requests.filter((r) => r.url.includes('/api/nutrition/scan-photo')).length;
    expect(before).toBe(1);

    await user.click(screen.getByRole('button', { name: /try again|retry/i }));

    // A second upload happened with no further interaction from the user. The
    // old behaviour reopened the file picker and sent nothing.
    await waitFor(() => {
      const after = requests.filter((r) => r.url.includes('/api/nutrition/scan-photo')).length;
      expect(after).toBe(2);
    });
  });

  it('still offers a different photo, for when the photo itself was the problem', async () => {
    await scanWith([...baseRoutes(), BUSY]);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /different photo/i })).toBeInTheDocument();
  });

  it('succeeds on the retry when the provider recovers', async () => {
    // Busy once, then fine — which is what a demand spike actually looks like.
    let calls = 0;
    const flaky: StubRoute = {
      match: '/api/nutrition/scan-photo',
      method: 'POST',
      status: () => (calls === 1 ? 503 : 200),
      response: () => {
        calls += 1;
        return calls === 1
          ? {
              error: {
                code: 'AI_UNAVAILABLE',
                message: 'Could not analyse that photo right now.',
              },
            }
          : ESTIMATE;
      },
    };

    const { user } = await scanWith([...baseRoutes(), flaky]);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));

    // The estimate the user was owed, reached without re-picking the photo.
    expect(await screen.findByText('Grilled chicken with rice')).toBeInTheDocument();
  });
});

describe('a successful scan', () => {
  it('shows the estimate and never logs it by itself', async () => {
    const { requests } = await scanWith([
      ...baseRoutes(),
      { match: '/api/nutrition/scan-photo', method: 'POST', response: ESTIMATE },
    ]);

    expect(await screen.findByText('Grilled chicken with rice')).toBeInTheDocument();
    expect(screen.getByText(/620/)).toBeInTheDocument();
    expect(screen.getByText(/medium confidence/i)).toBeInTheDocument();

    // Spec rule 3: an AI guess is never written to the food diary on its own.
    expect(requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/log'))).toBe(
      false,
    );
  });

  it('logs only when the user confirms', async () => {
    const { user, requests } = await scanWith([
      ...baseRoutes(),
      { match: '/api/nutrition/scan-photo', method: 'POST', response: ESTIMATE },
      { match: '/api/nutrition/log', method: 'POST', status: 201, response: {} },
    ]);

    await screen.findByText('Grilled chicken with rice');
    await user.click(screen.getByRole('button', { name: /log this/i }));

    await waitFor(() => {
      const logged = requests.find(
        (r) => r.method === 'POST' && r.url.includes('/api/nutrition/log'),
      );
      expect(logged).toBeDefined();
      expect((logged?.body as { foodItemId: string }).foodItemId).toBe('estimate:abc');
    });
  });
});
