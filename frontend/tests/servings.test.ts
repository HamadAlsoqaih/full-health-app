/**
 * Serving sizes.
 *
 * The case driving all of this: a bucket the scan called "8 pieces", of which
 * five were eaten. That is 5/8 of one serving. Typing 0.625 on a phone is not a
 * thing anyone should be asked to do, so both the parser and the picker have to
 * make fractions the easy path.
 */
import { describe, expect, it } from 'vitest';
import {
  FRACTIONS,
  WHOLE_NUMBERS,
  formatServingSize,
  isPickable,
  parseServingSize,
  toWholeAndFraction,
} from '@/shared/lib/servings';

describe('the fraction list', () => {
  it('is ascending, so the wheel reads in order', () => {
    const values = FRACTIONS.map((f) => f.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('has no duplicate values', () => {
    // 2/4 and 1/2 are the same position on a wheel; only one should be there.
    const values = FRACTIONS.map((f) => f.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each([
    ['1/8', 0.125],
    ['1/6', 1 / 6],
    ['1/4', 0.25],
    ['1/3', 1 / 3],
    ['1/2', 0.5],
    ['5/8', 0.625],
    ['2/3', 2 / 3],
    ['3/4', 0.75],
    ['3/10', 0.3],
  ])('offers %s', (label, value) => {
    const found = FRACTIONS.find((f) => f.label === label);
    expect(found).toBeDefined();
    expect(found?.value).toBeCloseTo(value, 6);
  });

  it('covers the piece counts buckets come in', () => {
    // Without these, "3 of 10 pieces" or "1 of 6" could not be picked at all —
    // which is the exact case the picker exists for.
    for (const denominator of [2, 3, 4, 5, 6, 8, 10]) {
      expect(FRACTIONS.some((f) => f.denominator === denominator)).toBe(true);
    }
  });

  it('starts the whole-number wheel at 0, so a bare fraction is reachable', () => {
    // With a wheel starting at 1 there is no way to express 5/8 at all.
    expect(WHOLE_NUMBERS[0]).toBe(0);
    expect(WHOLE_NUMBERS.at(-1)).toBe(99);
  });
});

describe('parseServingSize', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['0.625', 0.625],
    ['1.5', 1.5],
    ['  3  ', 3],
  ])('reads the plain number %s', (input, expected) => {
    expect(parseServingSize(input)).toBeCloseTo(expected, 6);
  });

  it.each([
    ['5/8', 0.625],
    ['1/2', 0.5],
    ['3/10', 0.3],
    ['1 / 2', 0.5],
  ])('reads the fraction %s', (input, expected) => {
    expect(parseServingSize(input)).toBeCloseTo(expected, 6);
  });

  it.each([
    ['2 1/2', 2.5],
    ['1 3/4', 1.75],
  ])('reads the mixed number %s', (input, expected) => {
    expect(parseServingSize(input)).toBeCloseTo(expected, 6);
  });

  it.each([
    ['½', 0.5],
    ['2½', 2.5],
    ['⅝', 0.625],
  ])('reads the typed glyph %s', (input, expected) => {
    expect(parseServingSize(input)).toBeCloseTo(expected, 6);
  });

  it.each(['', '   ', '0', '-1', 'abc', '1/0', '5/', '/8', '1..5'])(
    'refuses %s rather than guessing',
    (input) => {
      // Returning null lets the caller decline to log, instead of quietly
      // treating a typo as one whole serving.
      expect(parseServingSize(input)).toBeNull();
    },
  );
});

describe('toWholeAndFraction', () => {
  it('splits 5/8 into no whole part and the 5/8 option', () => {
    const { whole, fraction } = toWholeAndFraction(0.625);
    expect(whole).toBe(0);
    expect(fraction?.label).toBe('5/8');
  });

  it('splits 2.5 into 2 and 1/2', () => {
    const { whole, fraction } = toWholeAndFraction(2.5);
    expect(whole).toBe(2);
    expect(fraction?.label).toBe('1/2');
  });

  it('reports no fraction for a whole number', () => {
    expect(toWholeAndFraction(3)).toEqual({ whole: 3, fraction: null });
  });

  it('survives a third, which no float holds exactly', () => {
    // 1/3 stored and read back must still land on the 1/3 option, or the picker
    // silently resets the user's choice every time it reopens.
    const { whole, fraction } = toWholeAndFraction(1 / 3);
    expect(whole).toBe(0);
    expect(fraction?.label).toBe('1/3');

    const mixed = toWholeAndFraction(2 + 2 / 3);
    expect(mixed.whole).toBe(2);
    expect(mixed.fraction?.label).toBe('2/3');
  });
});

describe('isPickable', () => {
  it.each([1, 2, 0.5, 0.625, 2.5, 1 / 3, 0.3, 99])('says %s can be set on the wheels', (value) => {
    expect(isPickable(value)).toBe(true);
  });

  it.each([0, -1, 0.123, 1.07, 100, Number.NaN, Number.POSITIVE_INFINITY])(
    'says %s cannot',
    (value) => {
      // An odd decimal typed by hand has to keep working; it just cannot be
      // shown on the wheels without changing it, so the field stays in typed
      // mode rather than rounding the user's number behind their back.
      expect(isPickable(value)).toBe(false);
    },
  );
});

describe('formatServingSize', () => {
  it.each([
    [1, '1'],
    [3, '3'],
    [0.625, '5/8'],
    [0.5, '1/2'],
    [2.5, '2 1/2'],
    [1.75, '1 3/4'],
    [1 / 3, '1/3'],
  ])('shows %s as %s', (value, expected) => {
    // A fraction is preferred over a decimal because "5/8 of 8 pieces" can be
    // checked against the bucket in front of you. "0.63" cannot.
    expect(formatServingSize(value)).toBe(expected);
  });

  it('round-trips through the parser', () => {
    for (const value of [0.125, 0.25, 1 / 3, 0.5, 0.625, 1, 1.5, 2 + 3 / 4, 12]) {
      expect(parseServingSize(formatServingSize(value))).toBeCloseTo(value, 6);
    }
  });
});
