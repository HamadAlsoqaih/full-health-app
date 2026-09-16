/**
 * Calendar dates, in the user's own timezone.
 *
 * This exists because `new Date().toISOString().slice(0, 10)` — the obvious way
 * to get a YYYY-MM-DD — gives the **UTC** date, and for a food log that is
 * wrong everywhere except UTC itself:
 *
 *   - East of UTC (Riyadh, UTC+3): between midnight and 03:00 local, UTC is
 *     still on yesterday, so an early breakfast lands on the previous day's log.
 *   - West of UTC (New York, UTC-5): from 19:00 local, UTC has already rolled
 *     over, so dinner is filed under tomorrow and today's calorie total appears
 *     to reset in the evening.
 *
 * A day boundary a tracker gets wrong is not cosmetic: it splits one day's
 * intake across two rows and makes every total for both days incorrect.
 *
 * The date is built from the local getters rather than by offsetting the
 * timestamp, so it is correct across daylight-saving transitions too.
 */

const pad = (value: number): string => String(value).padStart(2, '0');

/** Formats a Date as YYYY-MM-DD in the local timezone. */
export function toLocalDateIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The user's current calendar date, as the API's `date` fields expect it. */
export function todayIso(): string {
  return toLocalDateIso(new Date());
}
