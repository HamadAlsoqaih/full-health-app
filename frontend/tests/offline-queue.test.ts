/**
 * Offline outbox tests.
 *
 * The properties asserted here are the ones that prevent data loss and
 * duplication for a user logging a workout in a gym basement:
 *   - order is preserved, because a food log can reference a custom food created
 *     moments earlier in the same offline session;
 *   - a 200 replay counts as success and the item is dropped, not retried;
 *   - a permanent rejection is dropped, so it cannot block the queue forever;
 *   - a transient failure stops the flush and keeps everything after it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clear,
  enqueue,
  flush,
  listPending,
  offlineEndpoints,
  pendingCount,
} from '../src/shared/lib/offlineQueue';

const token = () => 'test-token:user-1';

/** Records every request and answers from a scripted list of responses. */
function scriptedFetch(responses: Array<number | Error>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ ok: true }), { status: next ?? 201 });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

beforeEach(async () => {
  await clear();
  vi.stubGlobal('navigator', { onLine: true });
});

describe('enqueue', () => {
  it('stores an item keyed by its client id, so a re-enqueue does not duplicate', async () => {
    await enqueue('workout-log', 'wl-0000001', { clientId: 'wl-0000001' });
    await enqueue('workout-log', 'wl-0000001', { clientId: 'wl-0000001' });

    expect(await pendingCount()).toBe(1);
  });

  it('reports the pending count through onChange', async () => {
    const onChange = vi.fn();
    await enqueue('custom-food', 'cf-0000001', {}, { onChange });
    expect(onChange).toHaveBeenCalledWith(1);
  });
});

describe('flush ordering', () => {
  it('sends items in the order they were queued', async () => {
    await enqueue('custom-food', 'cf-0000001', { clientId: 'cf-0000001', name: 'Shake' });
    await enqueue('food-log', 'fl-0000001', { clientId: 'fl-0000001', foodItemId: 'custom:x' });
    await enqueue('workout-log', 'wl-0000001', { clientId: 'wl-0000001' });

    const { impl, calls } = scriptedFetch([201, 201, 201]);
    const result = await flush(token, { fetchImpl: impl });

    expect(result.sent).toBe(3);
    expect(result.remaining).toBe(0);
    // The custom food must precede the log that references it.
    expect(calls.map((c) => c.url)).toEqual([
      offlineEndpoints['custom-food'],
      offlineEndpoints['food-log'],
      offlineEndpoints['workout-log'],
    ]);
  });

  it('sends each item to the endpoint for its kind', async () => {
    await enqueue('body-measurement', 'bm-0000001', { clientId: 'bm-0000001', weightKg: 88 });
    const { impl, calls } = scriptedFetch([201]);
    await flush(token, { fetchImpl: impl });

    expect(calls[0]?.url).toBe('/api/body-composition/entry');
    expect(calls[0]?.body).toMatchObject({ clientId: 'bm-0000001', weightKg: 88 });
  });

  it('attaches the bearer token', async () => {
    await enqueue('workout-log', 'wl-0000001', {});
    const impl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token:user-1');
      return new Response('{}', { status: 201 });
    });
    await flush(token, { fetchImpl: impl as unknown as typeof globalThis.fetch });
    expect(impl).toHaveBeenCalled();
  });
});

describe('flush outcomes', () => {
  it('treats a 200 replay as success and drops the item', async () => {
    await enqueue('workout-log', 'wl-0000001', {});
    const { impl } = scriptedFetch([200]);

    const result = await flush(token, { fetchImpl: impl });

    // This is the contract that stops a retried sync duplicating a row: the
    // server already stored it, so the queue must let it go.
    expect(result.sent).toBe(1);
    expect(await pendingCount()).toBe(0);
  });

  it('drops a permanently rejected item instead of retrying forever', async () => {
    await enqueue('workout-log', 'wl-bad-0001', { clientId: 'wl-bad-0001' });
    await enqueue('workout-log', 'wl-good-001', { clientId: 'wl-good-001' });

    // 400 for the first, 201 for the second.
    const { impl, calls } = scriptedFetch([400, 201]);
    const result = await flush(token, { fetchImpl: impl });

    expect(result.dropped).toBe(1);
    expect(result.sent).toBe(1);
    expect(await pendingCount()).toBe(0);
    // A rejected payload must not block the items behind it.
    expect(calls).toHaveLength(2);
  });

  it('keeps a 429 queued, since it explicitly invites a retry', async () => {
    await enqueue('workout-log', 'wl-0000001', {});
    const { impl } = scriptedFetch([429]);

    const result = await flush(token, { fetchImpl: impl });

    expect(result.sent).toBe(0);
    expect(result.dropped).toBe(0);
    expect(result.remaining).toBe(1);
    expect((await listPending())[0]?.attempts).toBe(1);
  });

  it('keeps a 408 queued too', async () => {
    await enqueue('workout-log', 'wl-0000001', {});
    const { impl } = scriptedFetch([408]);
    expect((await flush(token, { fetchImpl: impl })).remaining).toBe(1);
  });

  it('stops at the first transient failure and preserves what follows', async () => {
    await enqueue('custom-food', 'cf-0000001', {});
    await enqueue('food-log', 'fl-0000001', {});
    await enqueue('workout-log', 'wl-0000001', {});

    // First succeeds, second is a server error, third must not be attempted.
    const { impl, calls } = scriptedFetch([201, 500, 201]);
    const result = await flush(token, { fetchImpl: impl });

    expect(result.sent).toBe(1);
    expect(result.remaining).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it('treats a thrown fetch as transient and records the reason', async () => {
    await enqueue('workout-log', 'wl-0000001', {});
    const { impl } = scriptedFetch([new Error('Failed to fetch')]);

    const result = await flush(token, { fetchImpl: impl });

    expect(result.remaining).toBe(1);
    const pending = await listPending();
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.lastError).toBe('Failed to fetch');
  });

  it('retries a transient failure on a later flush and then succeeds', async () => {
    await enqueue('workout-log', 'wl-0000001', {});

    await flush(token, { fetchImpl: scriptedFetch([503]).impl });
    expect(await pendingCount()).toBe(1);

    await flush(token, { fetchImpl: scriptedFetch([201]).impl });
    expect(await pendingCount()).toBe(0);
  });
});

describe('flush preconditions', () => {
  it('does nothing while the browser reports itself offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await enqueue('workout-log', 'wl-0000001', {});
    const { impl, calls } = scriptedFetch([201]);

    const result = await flush(token, { fetchImpl: impl });

    expect(calls).toHaveLength(0);
    expect(result.remaining).toBe(1);
  });

  it('keeps the queue intact when there is no session to send it with', async () => {
    await enqueue('workout-log', 'wl-0000001', {});
    const { impl, calls } = scriptedFetch([201]);

    const result = await flush(() => null, { fetchImpl: impl });

    expect(calls).toHaveLength(0);
    // Survives until the user logs back in, rather than being discarded.
    expect(result.remaining).toBe(1);
  });
});
