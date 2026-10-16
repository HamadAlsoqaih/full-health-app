/**
 * Maintenance from a formula, for when there is not yet a weight trend to measure it.
 *
 * Mifflin-St Jeor (Am J Clin Nutr 1990) for resting energy, times a standard
 * activity factor. It was the most accurate of the common equations in
 * Frankenfield et al. (J Am Diet Assoc 2005), and still within ±10% of measured
 * resting energy for only about 70–80% of people — a starting point, which is why
 * the measured trend takes over as data arrives.
 */
import type { ActivityLevel, BodyProfile } from '@app/shared-types';

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  extra: 1.9,
};

export const ACTIVITY_LABEL: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary — desk job, little exercise',
  light: 'Light — exercise 1–3 days a week',
  moderate: 'Moderate — exercise 3–5 days a week',
  very: 'Very active — hard exercise 6–7 days a week',
  extra: 'Extra active — physical job plus training',
};

export function restingEnergy(body: BodyProfile, weightKg: number, now = new Date()): number {
  const age = now.getFullYear() - body.birthYear;
  const base = 10 * weightKg + 6.25 * body.heightCm - 5 * age;
  return body.sex === 'male' ? base + 5 : base - 161;
}

export function formulaMaintenance(body: BodyProfile, weightKg: number, now = new Date()): number {
  return Math.round(restingEnergy(body, weightKg, now) * ACTIVITY_FACTOR[body.activityLevel]);
}
