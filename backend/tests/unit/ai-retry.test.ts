/**
 * Which AI failures are retried, and which are not.
 *
 * Both halves matter equally, and the second one is the reason this file is
 * careful. Within minutes of each other, the same Gemini endpoint returned:
 *
 *   404 — the configured model had been retired for new API keys
 *   503 — "This model is currently experiencing high demand"
 *
 * The 503 should disappear behind a retry. The 404 must not: retrying it three
 * times would have tripled the time it took to surface and made a hard
 * configuration error look like a flaky network. A retry that hides a permanent
 * fault is worse than no retry at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { isTransient, retryTransient } from '../../src/services/ai/retry.js';

/** An error shaped like the ones the Google and Groq clients throw. */
function httpError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/** Never actually waits; the delays are not what is under test. */
const noSleep = async (): Promise<void> => undefined;

const opts = { label: 'test', sleep: noSleep };

describe('isTransient', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('treats %i as transient', (status) => {
    expect(isTransient(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 413, 422])('treats %i as permanent', (status) => {
    expect(isTransient(httpError(status))).toBe(false);
  });

  it('treats the real retired-model 404 as permanent', () => {
    // Verbatim from the failure this was written for.
    const error = httpError(
      404,
      '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer ' +
        'available to new users. Please update your code to use models/gemini-3.6-flash.",' +
        '"status":"NOT_FOUND"}}',
    );
    expect(isTransient(error)).toBe(false);
  });

  it('treats the real high-demand 503 as transient', () => {
    const error = httpError(
      503,
      '{"error":{"code":503,"message":"This model is currently experiencing high demand. ' +
        'Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}',
    );
    expect(isTransient(error)).toBe(true);
  });

  it.each([
    'fetch failed',
    'socket hang up',
    'read ECONNRESET',
    'connect ECONNREFUSED 1.2.3.4:443',
    'The operation was aborted due to timeout',
  ])('treats a connection failure as transient: %s', (message) => {
    // These arrive with no HTTP status at all.
    expect(isTransient(new Error(message))).toBe(true);
  });

  it('does not treat an ordinary programming error as transient', () => {
    expect(isTransient(new TypeError('cannot read properties of undefined'))).toBe(false);
  });
});

describe('retryTransient', () => {
  it('returns the first result without retrying when the call succeeds', async () => {
    const call = vi.fn().mockResolvedValue('ok');
    await expect(retryTransient(call, opts)).resolves.toBe('ok');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('recovers from a transient failure — the whole point', async () => {
    const call = vi.fn().mockRejectedValueOnce(httpError(503)).mockResolvedValue('estimate');

    await expect(retryTransient(call, opts)).resolves.toBe('estimate');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('keeps trying up to the attempt ceiling', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('estimate');

    await expect(retryTransient(call, opts)).resolves.toBe('estimate');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('gives up after the ceiling and rethrows the last error unchanged', async () => {
    const final = httpError(503, 'still busy');
    const call = vi.fn().mockRejectedValue(final);

    // Rethrown as-is, so the caller's own error handling and the message the
    // user sees are unaffected by the fact that retries happened.
    await expect(retryTransient(call, opts)).rejects.toBe(final);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a permanent failure', async () => {
    const error = httpError(404, 'model retired');
    const call = vi.fn().mockRejectedValue(error);

    await expect(retryTransient(call, opts)).rejects.toBe(error);
    // Once. Not three times, not three delays, and no pretending a
    // misconfiguration might fix itself.
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('stops retrying as soon as a permanent failure follows a transient one', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValue(httpError(401, 'bad key'));

    await expect(retryTransient(call, opts)).rejects.toMatchObject({ status: 401 });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('backs off for longer on each retry', async () => {
    const waited: number[] = [];
    const call = vi.fn().mockRejectedValue(httpError(503));

    await expect(
      retryTransient(call, {
        label: 'test',
        sleep: async (ms) => {
          waited.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(waited).toHaveLength(2);
    expect(waited[1]!).toBeGreaterThan(waited[0]!);
    // Short on purpose: the user is watching a spinner while this happens.
    expect(waited.reduce((a, b) => a + b, 0)).toBeLessThan(3000);
  });

  it('honours an explicit attempt count', async () => {
    const call = vi.fn().mockRejectedValue(httpError(503));
    await expect(
      retryTransient(call, { label: 'test', sleep: noSleep, attempts: 5 }),
    ).rejects.toThrow();
    expect(call).toHaveBeenCalledTimes(5);
  });
});
