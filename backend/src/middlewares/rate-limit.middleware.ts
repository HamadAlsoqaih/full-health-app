/**
 * Rate limiting.
 *
 * Two endpoints need it for reasons that are not about abuse:
 *
 *  - `POST /nutrition/scan-photo` draws on an AI vision quota that is ACCOUNT-WIDE,
 *    not per user. Without a global daily counter alongside the per-user limit, one
 *    enthusiastic user can exhaust the whole deployment's allowance for everybody.
 *  - `GET /nutrition/search` draws on a food-database quota that is per IP, and the
 *    API egresses from a single IP, so every user shares one bucket.
 *
 * Caveat worth stating rather than implying: the default store is in-process. On a
 * host that sleeps when idle and restarts on the next request, these counters reset.
 * That is acceptable here — they exist to stop accidental self-inflicted quota
 * exhaustion, not to withstand a determined attacker — but it is not durable, and a
 * multi-instance deployment would need a shared store.
 */
import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { ApiError } from '@app/shared-types';
import { config } from '../config/index.js';
import { aiQuotaExhausted } from '../errors.js';

const rateLimitedBody: ApiError = {
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.' },
};

/**
 * Per user when authenticated, per IP otherwise.
 *
 * Keying by user matters because everyone behind one NAT would otherwise share a
 * bucket. But the IP fallback must go through `ipKeyGenerator`, not use `req.ip`
 * raw: an IPv6 client is typically handed a /128 out of a /64 it controls
 * entirely, so keying on the full address lets it rotate through billions of
 * distinct keys and bypass the limit completely. `ipKeyGenerator` collapses the
 * address to its subnet so the limit applies to the party that actually owns it.
 *
 * IPv4 is unaffected — it is returned as-is.
 */
export function rateLimitKey(req: Request): string {
  const userId = req.user?.id;
  if (userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

function make(overrides: Partial<Options>): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    message: rateLimitedBody,
    // Limits are a nuisance in tests, not the thing under test.
    skip: () => config.isTest,
    ...overrides,
  });
}

/** Baseline for ordinary authenticated traffic. */
export const standardLimiter = make({ limit: 120 });

/** Search hits a shared upstream per-IP quota, so it is tighter. */
export const searchLimiter = make({ windowMs: 60_000, limit: 20 });

/** Vision calls are the expensive, quota-bounded ones. */
export const photoScanLimiter = make({ windowMs: 60_000, limit: 5 });

/** Unauthenticated endpoints are keyed by IP and kept deliberately low. */
export const authLimiter = make({ windowMs: 15 * 60_000, limit: 20 });

/**
 * Account-wide daily ceiling on vision calls, which per-user limits cannot express.
 *
 * In-process and therefore reset by a restart, same caveat as above. It is a
 * backstop against draining a shared free-tier allowance, not an accounting system.
 */
class GlobalDailyCounter {
  private day = '';
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly clock: () => Date,
  ) {}

  consume(): void {
    const today = this.clock().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
    if (this.count >= this.limit) {
      throw aiQuotaExhausted(
        "The app's daily AI image allowance is used up. Photo scanning will work again tomorrow; you can still log food manually.",
      );
    }
    this.count += 1;
  }

  /** Test seam. */
  reset(): void {
    this.day = '';
    this.count = 0;
  }
}

export function createVisionQuota(clock: () => Date): GlobalDailyCounter {
  return new GlobalDailyCounter(config.ai.visionDailyLimit, clock);
}

export type VisionQuota = GlobalDailyCounter;
