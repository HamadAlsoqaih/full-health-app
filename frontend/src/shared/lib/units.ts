/**
 * Unit conversion, used only at the UI edge.
 *
 * Everything is stored and transmitted in metric. These functions exist so a user
 * can type pounds and inches; the converted value is what leaves the component.
 * Nothing downstream — no API call, no database column, no trend calculation —
 * ever sees an imperial number.
 *
 * Factors are exact by definition, not approximations.
 */
const LB_PER_KG = 2.20462262185;
const CM_PER_IN = 2.54;

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const inToCm = (inches: number): number => inches * CM_PER_IN;

/** Formats a stored metric weight for display in the user's preferred units. */
export function formatWeight(kg: number, units: 'metric' | 'imperial'): string {
  return units === 'metric' ? `${kg.toFixed(1)} kg` : `${kgToLb(kg).toFixed(1)} lb`;
}

/** Formats a stored metric length for display. */
export function formatLength(cm: number, units: 'metric' | 'imperial'): string {
  return units === 'metric' ? `${cm.toFixed(1)} cm` : `${cmToIn(cm).toFixed(1)} in`;
}

/**
 * Formats a signed change, keeping the sign so a loss reads as a loss.
 * `toFixed` on a negative zero would otherwise render "-0.0".
 */
export function formatWeightChange(kg: number, units: 'metric' | 'imperial'): string {
  const value = units === 'metric' ? kg : kgToLb(kg);
  const rounded = Math.round(value * 10) / 10;
  const unit = units === 'metric' ? 'kg' : 'lb';
  if (rounded === 0) return `0.0 ${unit}`;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} ${unit}`;
}
