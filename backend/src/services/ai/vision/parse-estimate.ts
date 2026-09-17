/**
 * Parses a model's JSON reply into a photo estimate.
 *
 * Separated from the providers so it can be unit-tested without a live API — which
 * matters here, because neither provider is reachable from the build environment.
 *
 * Every numeric field is coerced and clamped. A model that returns "about 450" or a
 * negative number must not put a nonsense figure into someone's food log.
 */
export interface ParsedQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface ParsedEstimate {
  name: string;
  detectedItems: string[];
  servingLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: 'low' | 'medium';
  /** Empty when the model asked nothing, or asked in a shape not worth showing. */
  questions: ParsedQuestion[];
}

/** Upper bounds are sanity limits for a single photographed meal, not diet advice. */
const LIMITS = { calories: 5000, macro: 500 };

function toNumber(value: unknown, max: number): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value.replace(/[^\d.-]/g, ''))
        : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n * 10) / 10, max);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** The exact wording the prompt asks for, and what the UI relies on. */
const NOT_SURE = 'Not sure';

/**
 * Sanitises the follow-up questions.
 *
 * Every constraint here is a guard against a model that answers in a shape the
 * screen cannot use, and none of it could be verified against a live model — so
 * the rule throughout is that anything unusable is dropped rather than shown.
 * Zero questions is a perfectly good outcome; it just means the flow is what it
 * was before questions existed.
 */
function toQuestions(value: unknown): ParsedQuestion[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const seenQuestions = new Set<string>();
  const questions: ParsedQuestion[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;

    const question = typeof row.question === 'string' ? row.question.trim() : '';
    if (!question) continue;

    // The same question twice is a bug on screen however it is identified, so
    // the text is what decides. This is checked before the id, because a model
    // that repeats an id also tends to repeat the question.
    const fingerprint = question.toLowerCase();
    if (seenQuestions.has(fingerprint)) continue;

    /*
     * An id is always produced, because an answer has to be attachable to a
     * question.
     *
     * A colliding id does NOT drop the question: two genuinely different
     * questions given the same id by a sloppy model are still two questions
     * worth asking, so the second is re-slugged from its own text instead.
     * Losing a real question to a naming mistake would be the worse outcome,
     * and identical questions are already gone by the check above.
     */
    const rawId = typeof row.id === 'string' ? row.id.trim().toLowerCase() : '';
    const slug =
      fingerprint
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || `q${questions.length + 1}`;
    const id = rawId && !seenIds.has(rawId) ? rawId : slug;
    if (seenIds.has(id)) continue;

    const options = toStringArray(row.options)
      // De-duplicated case-insensitively: two options that read the same are one
      // option and a confusing screen.
      .filter(
        (option, index, all) =>
          all.findIndex((other) => other.toLowerCase() === option.toLowerCase()) === index,
      )
      .filter((option) => option.toLowerCase() !== NOT_SURE.toLowerCase())
      .slice(0, 4);

    // One real option is not a question, it is a statement.
    if (options.length < 2) continue;

    // "Not sure" is appended rather than trusted: forcing a guess between air
    // fried and deep fried produces worse data than an honest unknown, so the
    // escape hatch must exist on every question whether the model offered it or
    // not.
    questions.push({ id, question, options: [...options, NOT_SURE] });
    seenIds.add(id);
    seenQuestions.add(fingerprint);

    // Three is the cap. More than that and the questions cost more than the
    // accuracy they buy, and people start skipping them.
    if (questions.length === 3) break;
  }

  return questions;
}

export function parsePhotoEstimate(raw: string): ParsedEstimate | null {
  const text = raw.trim();
  if (!text) return null;

  // Models sometimes wrap JSON in prose or a code fence despite instructions, so
  // the outermost braces are extracted rather than trusting the whole string.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const servingLabel =
    typeof parsed.servingLabel === 'string' && parsed.servingLabel.trim()
      ? parsed.servingLabel.trim()
      : '1 serving';

  return {
    name: name || 'Estimated meal',
    detectedItems: toStringArray(parsed.detectedItems),
    servingLabel,
    calories: toNumber(parsed.calories, LIMITS.calories),
    proteinG: toNumber(parsed.proteinG, LIMITS.macro),
    carbsG: toNumber(parsed.carbsG, LIMITS.macro),
    fatG: toNumber(parsed.fatG, LIMITS.macro),
    // Anything other than an explicit "medium" is treated as low: the cautious
    // default is the honest one when the model's own signal is unclear.
    confidence: parsed.confidence === 'medium' ? 'medium' : 'low',
    questions: toQuestions(parsed.questions),
  };
}
