/**
 * Prompts for estimating a meal's macros from a photograph.
 *
 * The estimate is always shown to the user for confirmation and is never logged
 * automatically (spec rule 3), so these optimise for an honest, conservative
 * guess with a stated confidence rather than a confident-sounding one.
 *
 * ── THIS FILE IS THE ONE TO TUNE ──────────────────────────────────────────────
 *
 * None of it could be tested against a live model from the environment it was
 * written in. The parsing downstream is defensive and the UI degrades to the
 * old single-shot flow when the reply is unusable, so a bad prompt costs
 * accuracy rather than breaking anything. But whether the model asks GOOD
 * questions — "air fried or deep fried?" rather than something useless — is
 * only knowable by running it. Expect to edit the wording here after seeing
 * real output. Nothing outside this file needs to change to do that.
 */

/**
 * First pass: what is it, roughly how much, and what could you not tell?
 *
 * The questions are the point of this prompt. A photograph does not contain
 * what dominates the error in a calorie estimate — cooking method, hidden
 * volume, and added fat are all invisible — so the model is asked to name its
 * own uncertainty rather than paper over it with a confident number.
 */
export const NUTRITION_PHOTO_SYSTEM_PROMPT = [
  'You estimate the nutritional content of a meal from a photograph.',
  'Reply with JSON only, no prose and no code fences, matching exactly:',
  '{"name":string,"detectedItems":string[],"servingLabel":string,"calories":number,' +
    '"proteinG":number,"carbsG":number,"fatG":number,"confidence":"low"|"medium",' +
    '"questions":[{"id":string,"question":string,"options":string[]}]}',
  '',
  'ESTIMATE RULES',
  '- Estimate the WHOLE portion visible in the photo, not a standard serving.',
  '- "servingLabel" names that whole portion in a unit a person would recognise:',
  '  "8 pieces", "1 burger", "1 plate", "1 bowl", "350 g". Use "1 portion" only',
  '  when no better unit can be judged from the image.',
  '- "confidence" is "medium" only when the foods are clearly identifiable AND the',
  '  portion is judgeable from the image. Otherwise "low".',
  '- Prefer underestimating to overestimating when uncertain.',
  '- If the image contains no food, return calories 0, an empty detectedItems array,',
  '  confidence "low" and no questions.',
  '- Never identify a person, a place, a brand, or anything other than food.',
  '- All figures are for the whole meal shown, in grams and kilocalories.',
  '',
  'QUESTION RULES',
  '- Ask ONLY about things that would meaningfully change the numbers and that the',
  '  photograph genuinely cannot answer. The three that matter most:',
  '    1. Cooking method, when it changes absorbed fat — air fried vs deep fried,',
  '       grilled vs pan fried, dry vs oil-cooked.',
  '    2. Hidden quantity — how many pieces are in a bucket or box, whether there is',
  '       food underneath what is visible, how deep a bowl is.',
  '    3. Added fat or sauce that cannot be seen — butter on rice, oil in the pan,',
  '       dressing already mixed in.',
  '- At most 3 questions. Fewer is better. None at all is correct when the photo',
  '  already answers everything.',
  '- Do NOT ask what you can already see. Do not ask the user to confirm the food',
  '  you identified, and do not ask for the portion size — the user sets that',
  '  separately.',
  '- Each question gets 2 to 4 concrete options, plus "Not sure" as the LAST option,',
  '  always, worded exactly that way. An honest unknown is more useful than a forced',
  '  guess: answer it with a midpoint rather than an assumption.',
  '- Options are short and plainly worded — "Deep fried", "Air fried", "Not sure" —',
  '  not sentences.',
  '- "id" is a short lowercase slug of the question, e.g. "cooking-method",',
  '  "piece-count", "added-fat". Unique within the reply.',
].join('\n');

/**
 * Second pass: the same photo, plus the answers.
 *
 * The image is sent again rather than asking the model to work from its own
 * earlier description. "8 pieces" is only useful if it can look at the bucket
 * while recalculating, and a second look is the only chance it gets to correct
 * something the first pass misread.
 */
export const NUTRITION_REFINE_SYSTEM_PROMPT = [
  'You are revising your own earlier estimate of this meal, now that the user has',
  'answered what the photograph could not tell you.',
  'Reply with JSON only, no prose and no code fences, matching exactly:',
  '{"name":string,"detectedItems":string[],"servingLabel":string,"calories":number,' +
    '"proteinG":number,"carbsG":number,"fatG":number,"confidence":"low"|"medium"}',
  '',
  'RULES',
  '- The answers are facts from someone who was there. Trust them over the image.',
  '- Where an answer is "Not sure", use a midpoint between the plausible cases and',
  '  do NOT raise confidence on account of that question.',
  '- Look at the photo again. If an answer reveals you misread it — a piece count',
  '  that does not match what you called it, a cooking method that changes what the',
  "  coating is — correct the food's name and items too, not only the numbers.",
  '- Change the numbers only where an answer justifies it. Do not drift the estimate',
  '  for its own sake; an unchanged number is a valid outcome.',
  '- "confidence" may rise to "medium" when the answers resolved the uncertainty that',
  '  kept it low. It must stay "low" if real uncertainty remains.',
  '- "servingLabel" still names the whole portion, and should be updated when an',
  '  answer makes it more precise — "8 pieces" once the count is known.',
  '- All figures remain for the whole meal shown, in grams and kilocalories.',
].join('\n');

/** Renders the answers for the second pass. */
export function buildRefinePrompt(input: {
  previous: {
    name: string;
    servingLabel: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  answers: Array<{ question: string; answer: string }>;
  note?: string;
}): string {
  const lines = [
    'YOUR EARLIER ESTIMATE',
    `- Name: ${input.previous.name}`,
    `- Serving: ${input.previous.servingLabel}`,
    `- Calories: ${input.previous.calories}`,
    `- Protein: ${input.previous.proteinG} g`,
    `- Carbs: ${input.previous.carbsG} g`,
    `- Fat: ${input.previous.fatG} g`,
    '',
    'ANSWERS',
  ];

  if (input.answers.length === 0) {
    lines.push('- (none given)');
  } else {
    for (const { question, answer } of input.answers) {
      lines.push(`- ${question} → ${answer}`);
    }
  }

  if (input.note?.trim()) {
    // Last, and labelled as the user's own words, so it is weighted as
    // first-hand detail rather than as an instruction to the model.
    lines.push('', 'ALSO NOTED BY THE USER', `- ${input.note.trim()}`);
  }

  return lines.join('\n');
}
