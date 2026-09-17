/**
 * Keeping a scanned meal for next time.
 *
 * The property that matters most here: what gets saved is the WHOLE thing the
 * scan described, not the amount that was logged. If the scan called it "8
 * pieces" at 2400 kcal and only five were eaten, the saved item is still the
 * full 8 pieces — because it is a definition of the food, and how much was
 * eaten belongs to each individual log entry. Saving five pieces' worth would
 * make the item useless at any other portion.
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

/** A bucket: the case the whole serving model was designed around. */
const BUCKET: PhotoScanResult = {
  estimate: {
    id: 'estimate:bucket',
    name: 'Fried chicken pieces with sauce',
    source: 'ai-photo-estimate',
    servingLabel: '8 pieces',
    calories: 2400,
    proteinG: 160,
    carbsG: 120,
    fatG: 140,
  },
  confidence: 'low',
  detectedItems: ['fried chicken', 'dipping sauce'],
  autoLogged: false,
};

function routes(extra: StubRoute[] = []): StubRoute[] {
  return [
    { match: '/api/users/me', method: 'GET', response: ONBOARDED },
    { match: '/api/nutrition/log', method: 'GET', response: [] },
    { match: '/api/nutrition/custom-foods', method: 'GET', response: [] },
    { match: '/api/nutrition/scan-photo', method: 'POST', response: BUCKET },
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
    ...extra,
  ];
}

const SAVE_OK: StubRoute = {
  match: '/api/nutrition/custom-foods',
  method: 'POST',
  status: 201,
  response: { id: 'food-1', clientId: 'c', name: 'Albaik meal', createdAt: '' },
};

/** Scans a photo and returns once the estimate is on screen. */
async function scanned(extra: StubRoute[] = []) {
  const user = userEvent.setup();
  const rendered = renderApp({
    session: SESSION,
    routes: routes(extra),
    initialPath: '/app/nutrition',
  });

  await user.click(await screen.findByRole('button', { name: /scan a meal|photo/i }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(
    input,
    new File([new Uint8Array([1, 2])], 'bucket.jpg', { type: 'image/jpeg' }),
  );
  await screen.findByText('Fried chicken pieces with sauce');

  return { user, ...rendered };
}

/** Opens the save form. */
async function openSaveForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Save to my foods' }));
  return screen.findByRole('heading', { name: 'Save to my foods' });
}

describe('the save form', () => {
  it('stays out of the way until asked for', async () => {
    await scanned();

    // Most scans are logged and forgotten; the form should not be in the way of
    // that. One button, no fields.
    expect(screen.getByRole('button', { name: 'Save to my foods' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('prefills the name so it can be renamed, not retyped', async () => {
    const { user } = await scanned();
    await openSaveForm(user);

    expect(screen.getByLabelText('Name')).toHaveValue('Fried chicken pieces with sauce');
    expect(screen.getByLabelText('Serving')).toHaveValue('8 pieces');
  });

  it('prefills the whole thing, not the amount that would be logged', async () => {
    const { user } = await scanned();
    await openSaveForm(user);

    expect(screen.getByLabelText('Calories')).toHaveValue('2400');
    expect(screen.getByLabelText('Protein')).toHaveValue('160');
  });
});

describe('saving', () => {
  it('sends the whole thing even when a fraction was being logged', async () => {
    const { user, requests } = await scanned([SAVE_OK]);

    // Set the log amount to 5 of the 8 pieces first — the saved item must be
    // unaffected by it.
    const servingSize = screen.getByLabelText('Serving size');
    await user.clear(servingSize);
    await user.type(servingSize, '5/8');

    await openSaveForm(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const saved = requests.find(
        (r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods'),
      );
      expect(saved).toBeDefined();
      // 2400, not 1500. The definition, not the portion.
      expect(saved?.body).toMatchObject({
        name: 'Fried chicken pieces with sauce',
        servingLabel: '8 pieces',
        calories: 2400,
        proteinG: 160,
      });
    });
  });

  it('saves the name you chose', async () => {
    const { user, requests } = await scanned([SAVE_OK]);
    await openSaveForm(user);

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Albaik meal');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const saved = requests.find(
        (r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods'),
      );
      expect((saved?.body as { name: string }).name).toBe('Albaik meal');
    });
  });

  it('saves corrected numbers, so a bad estimate is not kept forever', async () => {
    const { user, requests } = await scanned([SAVE_OK]);
    await openSaveForm(user);

    // This is the real risk in saving an AI guess: saved once, re-logged every
    // week. So the numbers have to be correctable before they are kept.
    const calories = screen.getByLabelText('Calories');
    await user.clear(calories);
    await user.type(calories, '1900');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const saved = requests.find(
        (r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods'),
      );
      expect((saved?.body as { calories: number }).calories).toBe(1900);
    });
  });

  it('mints a client id, so a retry cannot save it twice', async () => {
    const { user, requests } = await scanned([SAVE_OK]);
    await openSaveForm(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const saved = requests.find(
        (r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods'),
      );
      expect((saved?.body as { clientId: string }).clientId).toMatch(/\S/);
    });
  });

  it('refuses to save without a name', async () => {
    const { user, requests } = await scanned([SAVE_OK]);
    await openSaveForm(user);

    await user.clear(screen.getByLabelText('Name'));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods')),
    ).toBe(false);
  });

  it('confirms afterwards and does not offer to save again', async () => {
    const { user } = await scanned([SAVE_OK]);
    await openSaveForm(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // The toast says something similar, so match the line unique to the panel.
    expect(await screen.findByText(/no photo needed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to my foods' })).not.toBeInTheDocument();
  });
});

describe('saving and logging are separate', () => {
  it('saving does not log the meal', async () => {
    const { user, requests } = await scanned([SAVE_OK]);
    await openSaveForm(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText(/no photo needed/);

    // You might keep something to eat later without eating it now.
    expect(requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/log'))).toBe(
      false,
    );
  });

  it('logging does not save the meal', async () => {
    const { user, requests } = await scanned([
      SAVE_OK,
      { match: '/api/nutrition/log', method: 'POST', status: 201, response: {} },
    ]);

    await user.click(screen.getByRole('button', { name: 'Log this' }));

    await waitFor(() => {
      expect(
        requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/log')),
      ).toBe(true);
    });
    // A one-off meal should not clutter the saved list.
    expect(
      requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods')),
    ).toBe(false);
  });

  it('can cancel out of the form without saving', async () => {
    const { user, requests } = await scanned([SAVE_OK]);
    await openSaveForm(user);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Save to my foods' })).toBeInTheDocument();
    expect(
      requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/custom-foods')),
    ).toBe(false);
  });
});
