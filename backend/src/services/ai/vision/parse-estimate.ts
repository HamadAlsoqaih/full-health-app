/**
 * Parses a model's JSON reply into a photo estimate.
 *
 * Separated from the providers so it can be unit-tested without a live API — which
 * matters here, because neither provider is reachable from the build environment.
 *
 * Every numeric field is coerced and clamped. A model that returns "about 450" or a
 * negative number must not put a nonsense figure into someone's food log.
 */
export interface ParsedEstimate {
  name: string;
  detectedItems: string[];
  servingLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: 'low' | 'medium';
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
  };
}
