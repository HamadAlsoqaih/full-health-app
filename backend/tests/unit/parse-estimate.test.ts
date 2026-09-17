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
      // Always present, empty when the model asked nothing.
      questions: [],
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

/**
 * The follow-up questions.
 *
 * None of this could be checked against a live model, so every rule here is a
 * guard against a shape the screen cannot use — and the rule throughout is that
 * anything unusable is dropped rather than shown. Zero questions is a fine
 * outcome: it means the flow is what it was before questions existed.
 */
describe('follow-up questions', () => {
  const withQuestions = (questions: unknown): string =>
    JSON.stringify({
      name: 'Fried chicken',
      detectedItems: ['fried chicken'],
      servingLabel: '8 pieces',
      calories: 2400,
      proteinG: 160,
      carbsG: 120,
      fatG: 140,
      confidence: 'low',
      questions,
    });

  it('parses the shape the prompt asks for', () => {
    const result = parsePhotoEstimate(
      withQuestions([
        {
          id: 'cooking-method',
          question: 'How was this cooked?',
          options: ['Deep fried', 'Air fried'],
        },
      ]),
    );

    expect(result?.questions).toEqual([
      {
        id: 'cooking-method',
        question: 'How was this cooked?',
        // Appended, not trusted from the model.
        options: ['Deep fried', 'Air fried', 'Not sure'],
      },
    ]);
  });

  it('always adds "Not sure", even when the model forgot it', () => {
    const result = parsePhotoEstimate(
      withQuestions([{ id: 'q', question: 'Deep or air fried?', options: ['Deep', 'Air'] }]),
    );

    // Forcing a guess between air fried and deep fried produces worse data than
    // an honest unknown, so the escape hatch is not optional.
    expect(result?.questions[0]?.options.at(-1)).toBe('Not sure');
  });

  it('does not add a second "Not sure" when the model included one', () => {
    const result = parsePhotoEstimate(
      withQuestions([
        { id: 'q', question: 'Deep or air fried?', options: ['Deep', 'Air', 'not sure'] },
      ]),
    );

    expect(result?.questions[0]?.options).toEqual(['Deep', 'Air', 'Not sure']);
  });

  it('caps at three questions', () => {
    const result = parsePhotoEstimate(
      withQuestions(
        Array.from({ length: 7 }, (_, i) => ({
          id: `q${i}`,
          question: `Question ${i}?`,
          options: ['A', 'B'],
        })),
      ),
    );

    // More than three costs more than the accuracy it buys, and people start
    // skipping them entirely.
    expect(result?.questions).toHaveLength(3);
  });

  it('caps the options at four plus "Not sure"', () => {
    const result = parsePhotoEstimate(
      withQuestions([{ id: 'q', question: 'Which?', options: ['A', 'B', 'C', 'D', 'E', 'F'] }]),
    );

    expect(result?.questions[0]?.options).toEqual(['A', 'B', 'C', 'D', 'Not sure']);
  });

  it('drops a question with fewer than two real options', () => {
    const result = parsePhotoEstimate(
      withQuestions([
        { id: 'one', question: 'Only one choice?', options: ['Yes'] },
        { id: 'none', question: 'No choices?', options: [] },
        { id: 'good', question: 'Deep or air fried?', options: ['Deep', 'Air'] },
      ]),
    );

    // A single option is not a question, it is a statement.
    expect(result?.questions.map((q) => q.id)).toEqual(['good']);
  });

  it('de-duplicates options that read the same', () => {
    const result = parsePhotoEstimate(
      withQuestions([
        { id: 'q', question: 'Which?', options: ['Deep fried', 'DEEP FRIED', 'Air fried'] },
      ]),
    );

    expect(result?.questions[0]?.options).toEqual(['Deep fried', 'Air fried', 'Not sure']);
  });

  it('slugs an id from the question when the model omits one', () => {
    const result = parsePhotoEstimate(
      withQuestions([{ question: 'How was this cooked?', options: ['Deep', 'Air'] }]),
    );

    // An answer has to be attachable to a question, so an id is always produced.
    expect(result?.questions[0]?.id).toBe('how-was-this-cooked');
  });

  it('keeps both questions when the model reuses an id, re-slugging the second', () => {
    const result = parsePhotoEstimate(
      withQuestions([
        { id: 'same', question: 'How was this cooked?', options: ['A', 'B'] },
        { id: 'same', question: 'Is there food underneath?', options: ['C', 'D'] },
      ]),
    );

    // Two genuinely different questions are still two questions worth asking.
    // Dropping one over a naming mistake by the model would lose real
    // information; the ids just have to end up distinct.
    expect(result?.questions).toHaveLength(2);
    expect(result?.questions.map((q) => q.id)).toEqual(['same', 'is-there-food-underneath']);
  });

  it('shows the same question only once', () => {
    const result = parsePhotoEstimate(
      withQuestions([
        { id: 'a', question: 'How was this cooked?', options: ['A', 'B'] },
        { id: 'b', question: 'HOW WAS THIS COOKED?', options: ['C', 'D'] },
      ]),
    );

    // Deduplicated on the text, not the id — otherwise re-slugging above would
    // let a repeated question through under two different ids.
    expect(result?.questions).toHaveLength(1);
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['a string', 'How was this cooked?'],
    ['an object', { question: 'How?' }],
    ['an empty array', []],
    ['a list of junk', [null, 42, 'nope', {}]],
  ])('returns no questions when the field is %s', (_label, value) => {
    // Every one of these degrades to the plain single-shot flow, which is the
    // behaviour that shipped before questions existed. Nothing breaks.
    const result = parsePhotoEstimate(withQuestions(value));
    expect(result?.questions).toEqual([]);
    // The estimate itself still parsed.
    expect(result?.calories).toBe(2400);
  });
});
