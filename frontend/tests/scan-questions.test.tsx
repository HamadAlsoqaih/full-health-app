/**
 * The two-pass scan, driven through the real screen.
 *
 * What is being protected here is mostly adoption, not correctness. The feature
 * asks someone to answer questions about their lunch, and it only survives
 * contact with real use if:
 *
 *   - skipping is always available and sticky,
 *   - "Not sure" is a first-class answer rather than a hidden escape,
 *   - the change in the number is visible, so answering feels worth it,
 *   - and a failure in the second pass does not cost the first estimate.
 *
 * Each of those is a test below.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhotoRefineResult, PhotoScanResult } from '@app/shared-types';
import { SESSION, makeUser, renderApp } from './helpers/render';
import type { StubRoute } from './helpers/render';

const ONBOARDED = makeUser({
  onboarding: { goalsSubmitted: true, startingStatsSubmitted: true, complete: true },
});

/** The bucket case: a photo that genuinely cannot answer what matters. */
const FIRST_PASS: PhotoScanResult = {
  estimate: {
    id: 'estimate:bucket',
    name: 'Fried chicken pieces',
    source: 'ai-photo-estimate',
    servingLabel: '8 pieces',
    calories: 1800,
    proteinG: 140,
    carbsG: 90,
    fatG: 100,
  },
  confidence: 'low',
  detectedItems: ['fried chicken'],
  questions: [
    {
      id: 'cooking-method',
      question: 'How was this cooked?',
      options: ['Deep fried', 'Air fried', 'Not sure'],
    },
    {
      id: 'hidden-food',
      question: 'Is there more food underneath?',
      options: ['No', 'Yes, about the same again', 'Not sure'],
    },
  ],
  autoLogged: false,
};

/** Deep frying pushed it up — the change the user should see. */
const SECOND_PASS: PhotoRefineResult = {
  estimate: { ...FIRST_PASS.estimate, calories: 2520, fatG: 140 },
  confidence: 'medium',
  detectedItems: ['fried chicken'],
  previousCalories: 1800,
  autoLogged: false,
};

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

/**
 * Note the ORDER: the refine route is registered first, because the stub
 * matches on a URL substring and `/scan-photo` would otherwise swallow
 * `/scan-photo/refine`.
 */
function scanRoutes(refine?: StubRoute): StubRoute[] {
  return [
    ...(refine ? [refine] : []),
    { match: '/api/nutrition/scan-photo', method: 'POST', response: FIRST_PASS },
    ...baseRoutes(),
  ];
}

const REFINE_OK: StubRoute = {
  match: '/api/nutrition/scan-photo/refine',
  method: 'POST',
  response: SECOND_PASS,
};

async function scanned(routes: StubRoute[]) {
  const user = userEvent.setup();
  const rendered = renderApp({ session: SESSION, routes, initialPath: '/app/nutrition' });

  await user.click(await screen.findByRole('button', { name: /scan a meal|photo/i }));
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(
    input,
    new File([new Uint8Array([1, 2])], 'bucket.jpg', { type: 'image/jpeg' }),
  );
  await screen.findByText('Fried chicken pieces');

  return { user, ...rendered };
}

describe('the questions', () => {
  it('appear when the model had something it could not tell', async () => {
    await scanned(scanRoutes(REFINE_OK));

    expect(await screen.findByText('How was this cooked?')).toBeInTheDocument();
    expect(screen.getByText('Is there more food underneath?')).toBeInTheDocument();
  });

  it('offers "Not sure" on every question, as a real option', async () => {
    await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    // One per question. Forcing a guess between air fried and deep fried
    // produces worse data than an honest unknown.
    expect(screen.getAllByRole('button', { name: 'Not sure' })).toHaveLength(2);
  });

  it('do not appear at all when the model asked nothing', async () => {
    const { questions: _dropped, ...withoutQuestions } = FIRST_PASS;
    await scanned([
      { match: '/api/nutrition/scan-photo', method: 'POST', response: withoutQuestions },
      ...baseRoutes(),
    ]);

    await screen.findByText('Fried chicken pieces');
    // The flow is exactly what it was before questions existed.
    expect(screen.queryByText(/photo cannot show/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log this' })).toBeInTheDocument();
  });

  it('can be answered and un-answered by tapping twice', async () => {
    const { user } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    const deepFried = screen.getByRole('button', { name: 'Deep fried' });
    await user.click(deepFried);
    expect(deepFried).toHaveAttribute('aria-pressed', 'true');

    // A mis-tap has to be undoable without restarting the scan.
    await user.click(deepFried);
    expect(deepFried).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('answering them', () => {
  it('sends the answers with the question text and the photo again', async () => {
    const { user, requests } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    await user.click(screen.getByRole('button', { name: 'Deep fried' }));
    await user.click(screen.getByRole('button', { name: /Update the estimate/ }));

    await waitFor(() => {
      const refine = requests.find((r) => r.url.includes('/scan-photo/refine'));
      expect(refine).toBeDefined();

      const body = refine!.body as { photo?: unknown; answers?: string };
      // The photo goes up again: "8 pieces" only helps if the model can look at
      // the bucket while recalculating.
      expect(body.photo).toMatchObject({ name: 'bucket.jpg' });

      const parsed = JSON.parse(body.answers!) as {
        previousEstimateId: string;
        answers: Array<{ questionId: string; question: string; option: string | null }>;
      };
      expect(parsed.previousEstimateId).toBe('estimate:bucket');
      expect(parsed.answers).toEqual([
        {
          questionId: 'cooking-method',
          // The text, not the slug — the model reads the question.
          question: 'How was this cooked?',
          option: 'Deep fried',
        },
        { questionId: 'hidden-food', question: 'Is there more food underneath?', option: null },
      ]);
    });
  });

  it('shows how the number moved', async () => {
    const { user } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    await user.click(screen.getByRole('button', { name: 'Deep fried' }));
    await user.click(screen.getByRole('button', { name: /Update the estimate/ }));

    // The whole reason to answer again next time.
    const updated = await screen.findByText(/Updated from/);
    expect(updated).toHaveTextContent('1800');
    expect(updated).toHaveTextContent('2520');
  });

  it('says so plainly when the answers changed nothing', async () => {
    const unchanged: StubRoute = {
      match: '/api/nutrition/scan-photo/refine',
      method: 'POST',
      response: { ...SECOND_PASS, estimate: FIRST_PASS.estimate, previousCalories: 1800 },
    };
    const { user } = await scanned(scanRoutes(unchanged));
    await screen.findByText('How was this cooked?');

    // One "Not sure" per question, so pick the first.
    await user.click(screen.getAllByRole('button', { name: 'Not sure' })[0]!);
    await user.click(screen.getByRole('button', { name: /Update the estimate/ }));

    // An unchanged estimate is a valid outcome and should not look like a bug.
    expect(await screen.findByText(/did not change the estimate/)).toBeInTheDocument();
  });

  it('sends the free-text note when one is written', async () => {
    const { user, requests } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    // Collapsed until asked for, so it is not in the way of the common case.
    await user.click(screen.getByRole('button', { name: 'Add details' }));
    await user.type(screen.getByLabelText('Anything else'), 'Butter in the rice');
    await user.click(screen.getByRole('button', { name: /Update the estimate/ }));

    await waitFor(() => {
      const refine = requests.find((r) => r.url.includes('/scan-photo/refine'));
      const parsed = JSON.parse((refine!.body as { answers: string }).answers) as { note?: string };
      expect(parsed.note).toBe('Butter in the rice');
    });
  });

  it('puts the questions away once answered', async () => {
    const { user } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    await user.click(screen.getByRole('button', { name: 'Deep fried' }));
    await user.click(screen.getByRole('button', { name: /Update the estimate/ }));

    // One round, not an interrogation.
    await waitFor(() => expect(screen.queryByText('How was this cooked?')).not.toBeInTheDocument());
  });
});

describe('skipping them', () => {
  it('keeps the first estimate and asks nothing', async () => {
    const { user, requests } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    await user.click(screen.getByRole('button', { name: /Skip/ }));

    // Some meals deserve five seconds, not thirty. A flow that demands answers
    // every time is one that stops being used.
    expect(screen.queryByText('How was this cooked?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log this' })).toBeInTheDocument();
    expect(requests.some((r) => r.url.includes('/scan-photo/refine'))).toBe(false);
  });

  it('stays skipped — the card does not come back', async () => {
    const { user } = await scanned(scanRoutes(REFINE_OK));
    await screen.findByText('How was this cooked?');

    await user.click(screen.getByRole('button', { name: /Skip/ }));
    // Interacting with the rest of the card must not resurrect it.
    await user.click(screen.getByRole('button', { name: 'Pick' }));

    expect(screen.queryByText('How was this cooked?')).not.toBeInTheDocument();
  });

  it('lets the estimate be logged while questions are still outstanding', async () => {
    const { user, requests } = await scanned([
      { match: '/api/nutrition/log', method: 'POST', status: 201, response: {} },
      ...scanRoutes(REFINE_OK),
    ]);
    await screen.findByText('How was this cooked?');

    // Wording admits the estimate is rougher than it could be, without blocking.
    await user.click(screen.getByRole('button', { name: 'Log this anyway' }));

    await waitFor(() => {
      expect(
        requests.some((r) => r.method === 'POST' && r.url.includes('/api/nutrition/log')),
      ).toBe(true);
    });
  });
});

describe('when the second pass fails', () => {
  it('keeps the first estimate and moves on', async () => {
    const failing: StubRoute = {
      match: '/api/nutrition/scan-photo/refine',
      method: 'POST',
      status: 503,
      response: {
        error: { code: 'AI_UNAVAILABLE', message: 'Could not update that estimate right now.' },
      },
    };
    const { user } = await scanned(scanRoutes(failing));
    await screen.findByText('How was this cooked?');

    await user.click(screen.getByRole('button', { name: 'Deep fried' }));
    await user.click(screen.getByRole('button', { name: /Update the estimate/ }));

    // A failed refinement is not fatal: the original estimate is still there and
    // still loggable. Trapping someone in a retry loop over an optional
    // improvement would be the wrong trade.
    await waitFor(() => expect(screen.queryByText('How was this cooked?')).not.toBeInTheDocument());
    expect(screen.getByText('Fried chicken pieces')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log this' })).toBeEnabled();
  });
});
