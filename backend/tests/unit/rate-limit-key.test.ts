/**
 * Rate-limit key derivation.
 *
 * The property under test is a security one, not a formatting one. An IPv6
 * client is normally handed a /128 out of a /64 it controls entirely, so keying
 * a limit on the full address lets that client rotate through an effectively
 * unlimited number of distinct keys and bypass the limit. Collapsing the address
 * to its subnet makes the limit apply to the party that actually owns it.
 *
 * express-rate-limit v8 detects the raw-`req.ip` mistake and warns at startup
 * (ERR_ERL_KEY_GEN_IPV6). These tests assert the behaviour rather than relying
 * on noticing that warning in a log.
 */
import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { rateLimitKey } from '../../src/middlewares/rate-limit.middleware.js';

/** Minimal stand-in for the fields the key derivation reads. */
const request = (ip: string | undefined, userId?: string): Request =>
  ({ ip, ...(userId ? { user: { id: userId, email: 'a@example.com' } } : {}) }) as Request;

describe('authenticated requests', () => {
  it('keys on the user, so one NAT does not share a bucket', () => {
    const a = rateLimitKey(request('203.0.113.10', 'user-1'));
    const b = rateLimitKey(request('203.0.113.10', 'user-2'));

    expect(a).not.toBe(b);
    expect(a).toContain('user-1');
  });

  it('keys the same user identically from different addresses', () => {
    // Moving between wifi and mobile data must not reset someone's limit.
    expect(rateLimitKey(request('203.0.113.10', 'user-1'))).toBe(
      rateLimitKey(request('198.51.100.7', 'user-1')),
    );
  });

  it('prefers the user over the IP even when both are present', () => {
    expect(rateLimitKey(request('203.0.113.10', 'user-1'))).not.toContain('203.0.113.10');
  });
});

describe('unauthenticated requests', () => {
  it('keys on the IP', () => {
    expect(rateLimitKey(request('203.0.113.10'))).toContain('203.0.113.10');
  });

  it('separates distinct IPv4 addresses', () => {
    expect(rateLimitKey(request('203.0.113.10'))).not.toBe(rateLimitKey(request('203.0.113.11')));
  });

  it('collapses IPv6 addresses in the same subnet to one key', () => {
    // THE REGRESSION. These are different /128 addresses from one block a single
    // client controls. Keyed raw, each would get its own fresh limit.
    const first = rateLimitKey(request('2001:db8:abcd:0012::1'));
    const second = rateLimitKey(request('2001:db8:abcd:0012::dead:beef'));
    const third = rateLimitKey(request('2001:db8:abcd:0012:ffff:ffff:ffff:ffff'));

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('still separates genuinely different IPv6 networks', () => {
    // Collapsing must not go so far that unrelated clients share a bucket.
    expect(rateLimitKey(request('2001:db8:abcd:0012::1'))).not.toBe(
      rateLimitKey(request('2600:1f18:aaaa:bbbb::1')),
    );
  });

  it('does not collide an IP key with a user key', () => {
    // Namespaced, so an attacker cannot craft a value that lands on a user's bucket.
    expect(rateLimitKey(request('203.0.113.10'))).not.toBe(
      rateLimitKey(request(undefined, '203.0.113.10')),
    );
  });

  it('falls back to a fixed key when the address is unavailable', () => {
    // Better that such requests share one bucket than get no limit at all.
    expect(() => rateLimitKey(request(undefined))).not.toThrow();
    expect(rateLimitKey(request(undefined))).toBeTruthy();
  });
});
