/**
 * Daily macro targets derived from a calorie and protein target.
 *
 * Goals store only calories and protein, so carbs and fat are derived: fat takes
 * a fixed share of calories and carbs take whatever remains. 25% sits inside the
 * 20–35% range the US Dietary Reference Intakes give for adults.
 */
export const FAT_SHARE_OF_CALORIES = 0.25;

const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function macroTargets(calories: number, proteinG: number): MacroTargets {
  const fatG = Math.round((calories * FAT_SHARE_OF_CALORIES) / KCAL_PER_G.fat);
  // Floored at zero: a protein target above the calorie budget leaves no carbs,
  // not negative carbs.
  const carbsKcal = calories - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbsG = Math.max(0, Math.round(carbsKcal / KCAL_PER_G.carbs));
  return { calories: Math.round(calories), proteinG: Math.round(proteinG), carbsG, fatG };
}
