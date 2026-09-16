/**
 * Local calendar dates.
 *
 * The regression: every `date` the app sent was `toISOString().slice(0, 10)`,
 * which is the UTC date. That is the wrong day for most of the world for part of
 * every day, and for a calorie tracker a wrong day boundary splits one day's
 * intake across two rows and makes both totals wrong.
 *
 * These tests move the process timezone, because that is the only way to catch
 * it — the old code was correct in UTC, which is exactly where CI runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toLocalDateIso, todayIso } from '@/shared/lib/dates';

afterEach(() => {
  vi.useRealTimers();
});

/** The UTC date for the same instant, i.e. what the old code produced. */
const utcDate = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

describe('toLocalDateIso', () => {
  it('formats with a zero-padded month and day', () => {
    expect(toLocalDateIso(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
    expect(toLocalDateIso(new Date(2026, 10, 30, 12))).toBe('2026-11-30');
  });

  it('uses the local day, not the UTC one', () => {
    // Fixed at midday local, so no timezone can push it across a boundary and
    // the assertion holds wherever this runs.
    const midday = new Date(2026, 5, 15, 12, 0, 0);
    expect(toLocalDateIso(midday)).toBe('2026-06-15');
  });
});

describe('todayIso in a timezone that is not UTC', () => {
  /**
   * Runs a callback with a fixed instant and a fixed timezone.
   *
   * `vi.useFakeTimers` controls the instant; TZ controls the offset applied to
   * it. Both are needed: the bug is entirely about the gap between them.
   */
  function at(instant: string, timeZone: string, assert: () => void): void {
    const original = process.env.TZ;
    process.env.TZ = timeZone;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    try {
      assert();
    } finally {
      vi.useRealTimers();
      process.env.TZ = original;
    }
  }

  it('is still yesterday in UTC at 01:30 in Riyadh, and the local date wins', () => {
    // 2026-06-15T22:30Z is 2026-06-16 01:30 in Riyadh (UTC+3).
    at('2026-06-15T22:30:00.000Z', 'Asia/Riyadh', () => {
      expect(utcDate('2026-06-15T22:30:00.000Z')).toBe('2026-06-15');
      expect(todayIso()).toBe('2026-06-16');
    });
  });

  it('is already tomorrow in UTC at 20:00 in New York, and the local date wins', () => {
    // 2026-06-16T00:00Z is 2026-06-15 20:00 in New York (UTC-4 in June).
    at('2026-06-16T00:00:00.000Z', 'America/New_York', () => {
      expect(utcDate('2026-06-16T00:00:00.000Z')).toBe('2026-06-16');
      expect(todayIso()).toBe('2026-06-15');
    });
  });

  it('agrees with UTC when the timezone is UTC', () => {
    at('2026-06-15T22:30:00.000Z', 'UTC', () => {
      expect(todayIso()).toBe('2026-06-15');
    });
  });

  it('is correct on the day a daylight-saving shift happens', () => {
    // 2026-03-29 is the European spring-forward. Offsetting a timestamp by a
    // fixed number of hours would land on the wrong side of it; reading the
    // local calendar fields does not.
    at('2026-03-29T10:00:00.000Z', 'Europe/London', () => {
      expect(todayIso()).toBe('2026-03-29');
    });
  });
});
