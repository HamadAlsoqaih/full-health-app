/**
 * Prompt for estimating a meal's macros from a photograph.
 *
 * The estimate is always shown to the user for confirmation and is never logged
 * automatically (spec rule 3), so the prompt optimises for an honest, conservative
 * guess with a stated confidence rather than a confident-sounding one.
 */
export const NUTRITION_PHOTO_SYSTEM_PROMPT = [
  'You estimate the nutritional content of a meal from a photograph.',
  'Reply with JSON only, no prose and no code fences, matching exactly:',
  '{"name":string,"detectedItems":string[],"servingLabel":string,"calories":number,"proteinG":number,"carbsG":number,"fatG":number,"confidence":"low"|"medium"}',
  'Rules:',
  '- Estimate the portion actually visible, not a standard serving.',
  '- "confidence" is "medium" only when the foods are clearly identifiable AND the portion size is judgeable from the image. Otherwise "low".',
  '- Prefer underestimating to overestimating when uncertain.',
  '- If the image contains no food, return calories 0, an empty detectedItems array and confidence "low".',
  '- Never identify a person, a place, a brand, or anything other than food.',
  '- All figures are for the whole meal shown, in grams and kilocalories.',
].join('\n');
