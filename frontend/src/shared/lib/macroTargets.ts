/**
 * Daily macro targets derived from a calorie and protein target.
 *
 * Goals store only calories and protein, so the rest is derived the way
 * body-composition-tracker does it: fat is a floor of 0.8 g per kg of body
 * weight, and carbs take whatever calories remain. Without a body weight, fat
 * falls back to 25% of calories, inside the 15–30% range used for dieting
 * athletes (Helms et al., JISSN 2014).
 */
export const FAT_FLOOR_G_PER_KG = 0.8;
export const FAT_SHARE_FALLBACK = 0.25;

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function macroTargets(calories: number, proteinG: number, weightKg?: number): MacroTargets {
  const fatG = Math.round(
    weightKg !== undefined && weightKg > 0
      ? weightKg * FAT_FLOOR_G_PER_KG
      : (calories * FAT_SHARE_FALLBACK) / KCAL_PER_G.fat,
  );
  // Floored at zero: protein and fat above the calorie budget leave no carbs,
  // not negative carbs.
  const carbsKcal = calories - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbsG = Math.max(0, Math.round(carbsKcal / KCAL_PER_G.carbs));
  return { calories: Math.round(calories), proteinG: Math.round(proteinG), carbsG, fatG };
}
