/**
 * Tests for the AI photo-estimate parser.
 *
 * This is a trust boundary: the input is model output, which is unvalidated text.
 * A model returning "about 450", a negative number, or prose around its JSON must
 * not be able to put a nonsense figure into someone's food log.
 */
import { describe, expect, it } from 'vitest';
import { parsePhotoEstimate } from '../../src/services/ai/vision/parse-estimate.js';

const VALID = JSON.stringify({
  name: 'Chicken and rice',
  detectedItems: ['grilled chicken breast', 'white rice', 'broccoli'],
  servingLabel: '1 plate',
  calories: 620,
  proteinG: 52,
  carbsG: 68,
  fatG: 14,
  confidence: 'medium',
});

describe('parsePhotoEstimate', () => {
  it('parses a well-formed response', () => {
    const result = parsePhotoEstimate(VALID);
    expect(result).toEqual({
      name: 'Chicken and rice',
      detectedItems: ['grilled chicken breast', 'white rice', 'broccoli'],
      servingLabel: '1 plate',
      calories: 620,
      proteinG: 52,
      carbsG: 68,
      fatG: 14,
      confidence: 'medium',
    });
  });

  it('extracts JSON wrapped in prose or a code fence', () => {
    for (const wrapped of [
      `Here is the estimate:\n\`\`\`json\n${VALID}\n\`\`\`\nHope that helps!`,
      `Sure! ${VALID}`,
      `${VALID}\n\nLet me know if you want more detail.`,
    ]) {
      expect(parsePhotoEstimate(wrapped)?.calories).toBe(620);
    }
  });

  it('returns null for anything that is not JSON at all', () => {
    for (const bad of ['', '   ', 'I cannot help with that.', '{ not json }', '[]']) {
      expect(parsePhotoEstimate(bad)).toBeNull();
    }
  });

  it('coerces a number expressed as text', () => {
    const result = parsePhotoEstimate(
      JSON.stringify({ name: 'Soup', calories: 'about 250 kcal', proteinG: '12' }),
    );
    expect(result?.calories).toBe(250);
    expect(result?.proteinG).toBe(12);
  });

  it('floors a negative or nonsensical value at zero', () => {
    const result = parsePhotoEstimate(
      JSON.stringify({ name: 'Weird', calories: -500, proteinG: Number.NaN, fatG: null }),
    );
    expect(result?.calories).toBe(0);
    expect(result?.proteinG).toBe(0);
    expect(result?.fatG).toBe(0);
  });

  it('clamps an absurd value to a sane ceiling', () => {
    const result = parsePhotoEstimate(
      JSON.stringify({ name: 'Absurd', calories: 999_999, proteinG: 99_999 }),
    );
    expect(result?.calories).toBe(5000);
    expect(result?.proteinG).toBe(500);
  });

  it('treats any confidence other than an explicit "medium" as low', () => {
    for (const confidence of ['high', 'very high', 'LOW', undefined, null, 42, 'certain']) {
      const result = parsePhotoEstimate(JSON.stringify({ name: 'X', calories: 1, confidence }));
      // The cautious default is the honest one when the model's signal is unclear.
      expect(result?.confidence).toBe('low');
    }
    expect(
      parsePhotoEstimate(JSON.stringify({ name: 'X', calories: 1, confidence: 'medium' }))
        ?.confidence,
    ).toBe('medium');
  });

  it('falls back to a usable name and serving label', () => {
    const result = parsePhotoEstimate(JSON.stringify({ calories: 100 }));
    expect(result?.name).toBe('Estimated meal');
    expect(result?.servingLabel).toBe('1 serving');
  });

  it('discards non-string entries in detectedItems and caps the list', () => {
    const result = parsePhotoEstimate(
      JSON.stringify({
        name: 'X',
        calories: 1,
        detectedItems: ['rice', 42, null, '  beans  ', '', ...Array(40).fill('filler')],
      }),
    );
    expect(result?.detectedItems.slice(0, 3)).toEqual(['rice', 'beans', 'filler']);
    expect(result?.detectedItems.length).toBeLessThanOrEqual(20);
  });

  it('handles the no-food-in-the-image case the prompt asks for', () => {
    const result = parsePhotoEstimate(
      JSON.stringify({
        name: 'No food detected',
        detectedItems: [],
        calories: 0,
        confidence: 'low',
      }),
    );
    expect(result?.calories).toBe(0);
    expect(result?.detectedItems).toEqual([]);
  });
});
