/**
 * Serving sizes, and the fractions people actually eat in.
 *
 * A serving is whatever the scan named — "8 pieces", "1 burger", "1 plate" —
 * and the serving size is how much of that you had. So "5 of the 8 pieces" is
 * 5/8 of one serving, not 5 servings.
 *
 * That makes fractions the common case rather than an edge case, and 0.625 is
 * not something anyone should have to work out on a phone. Hence both a parser
 * that accepts `5/8` directly and a fixed list for the picker.
 */

export interface Fraction {
  numerator: number;
  denominator: number;
  /** How it reads in the picker and the summary line. */
  label: string;
  value: number;
}

/**
 * Every fraction the picker offers, ascending.
 *
 * Denominators 2, 3, 4, 5, 6, 8 and 10, because those are how food is actually
 * divided: halves and quarters of a plate, thirds of a bowl, and the piece
 * counts buckets come in — 5, 6, 8, 10, 12. Without tenths, "3 of 10 pieces"
 * would be unreachable in the picker, which is exactly the case it exists for.
 *
 * Written as "5/8" rather than the Unicode ⅝. The single-glyph forms only exist
 * for some of these — there is no ⅗⁄₁₀ — so a mixed set would be inconsistent,
 * and the glyphs render small enough on a phone to be a guessing game. Plain
 * text also reads correctly to a screen reader.
 */
export const FRACTIONS: Fraction[] = [
  [1, 10],
  [1, 8],
  [1, 6],
  [1, 5],
  [1, 4],
  [3, 10],
  [1, 3],
  [3, 8],
  [2, 5],
  [1, 2],
  [3, 5],
  [5, 8],
  [2, 3],
  [7, 10],
  [3, 4],
  [4, 5],
  [5, 6],
  [7, 8],
  [9, 10],
].map(([numerator, denominator]) => ({
  numerator: numerator!,
  denominator: denominator!,
  label: `${numerator}/${denominator}`,
  value: numerator! / denominator!,
}));

/** Whole numbers the left wheel offers. Starts at 0 so a bare fraction works. */
export const WHOLE_NUMBERS: number[] = Array.from({ length: 100 }, (_, index) => index);

/**
 * Close enough to be the same serving size.
 *
 * 1/3 cannot be held exactly in a float, so a stored 0.3333333333333333 has to
 * match the 1/3 option when the picker reopens. A thousandth of a serving is
 * far below the precision of any calorie estimate.
 */
const EPSILON = 0.0005;

/** Splits a value into the two wheels: whole part and nearest listed fraction. */
export function toWholeAndFraction(value: number): { whole: number; fraction: Fraction | null } {
  const whole = Math.floor(value + EPSILON);
  const remainder = value - whole;

  if (remainder < EPSILON) return { whole, fraction: null };

  const match = FRACTIONS.find((candidate) => Math.abs(candidate.value - remainder) < EPSILON);
  return { whole, fraction: match ?? null };
}

/** True when the value is expressible on the two wheels without losing precision. */
export function isPickable(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0 || value >= 100) return false;
  const { whole, fraction } = toWholeAndFraction(value);
  const rebuilt = whole + (fraction?.value ?? 0);
  return Math.abs(rebuilt - value) < EPSILON;
}

/**
 * Reads a serving size the way a person would write one.
 *
 * Accepts `2`, `0.625`, `5/8`, `2 1/2` and `2½`. Returns null for anything that
 * is not a positive number, so the caller can refuse to log rather than
 * silently treating a typo as one serving.
 */
export function parseServingSize(input: string): number | null {
  const text = input.trim();
  if (text === '') return null;

  // A single Unicode fraction, in case one is pasted or typed on a keyboard
  // that offers them.
  const unicode: Record<string, number> = {
    '¼': 0.25,
    '½': 0.5,
    '¾': 0.75,
    '⅐': 1 / 7,
    '⅑': 1 / 9,
    '⅒': 0.1,
    '⅓': 1 / 3,
    '⅔': 2 / 3,
    '⅕': 0.2,
    '⅖': 0.4,
    '⅗': 0.6,
    '⅘': 0.8,
    '⅙': 1 / 6,
    '⅚': 5 / 6,
    '⅛': 0.125,
    '⅜': 0.375,
    '⅝': 0.625,
    '⅞': 0.875,
  };

  // "2½" or "½"
  const mixedUnicode = /^(\d*)\s*([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/.exec(text);
  if (mixedUnicode) {
    const whole = mixedUnicode[1] === '' ? 0 : Number(mixedUnicode[1]);
    const fraction = unicode[mixedUnicode[2]!];
    if (fraction === undefined) return null;
    const total = whole + fraction;
    return total > 0 ? total : null;
  }

  // "5/8" or "2 1/2"
  const slash = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (slash) {
    const whole = slash[1] === undefined ? 0 : Number(slash[1]);
    const numerator = Number(slash[2]);
    const denominator = Number(slash[3]);
    if (denominator === 0) return null;
    const total = whole + numerator / denominator;
    return total > 0 ? total : null;
  }

  // Plain decimal.
  const decimal = Number(text);
  if (!Number.isFinite(decimal) || decimal <= 0) return null;
  return decimal;
}

/**
 * The most readable form of a serving size.
 *
 * Prefers a fraction when there is an exact one, because "5/8 of 8 pieces" is
 * something you can check against the bucket in front of you and "0.63" is not.
 */
export function formatServingSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';

  const { whole, fraction } = toWholeAndFraction(value);

  if (!fraction) return String(whole);
  if (whole === 0) return fraction.label;
  return `${whole} ${fraction.label}`;
}
