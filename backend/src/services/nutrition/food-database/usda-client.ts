/**
 * USDA FoodData Central client.
 *
 * `fetch` is injected so the parsing logic can be unit-tested against checked-in
 * fixtures. That is not a stylistic preference here: api.nal.usda.gov is
 * unreachable from the build environment, so fixtures are the only way this code
 * gets tested at all.
 *
 * Without an API key the source reports itself disabled rather than throwing, and
 * search degrades to the cache plus the user's own custom foods.
 */
import type { FoodItem } from '@app/shared-types';
import { config } from '../../../config/index.js';
import { foodSourceUnavailable } from '../../../errors.js';
import { logger } from '../../../logger.js';
import type { FoodDatabasePort } from '../../../ports.js';

const BASE = 'https://api.nal.usda.gov/fdc/v1';

/** Nutrient numbers are stable identifiers; the display names are not. */
const NUTRIENT = { energyKcal: '208', protein: '203', fat: '204', carbs: '205', fiber: '291' };

interface UsdaNutrient {
  nutrientNumber?: string;
  value?: number;
}

interface UsdaFood {
  fdcId: number;
  description?: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: UsdaNutrient[];
}

function nutrient(food: UsdaFood, number: string): number {
  const match = food.foodNutrients?.find((n) => n.nutrientNumber === number);
  return typeof match?.value === 'number' ? match.value : 0;
}

/**
 * USDA reports per 100 g unless a serving size is given, so the label has to say
 * which — a number without its basis is worse than no number.
 */
function servingLabel(food: UsdaFood): string {
  if (food.servingSize && food.servingSizeUnit) {
    return `${food.servingSize} ${food.servingSizeUnit}`;
  }
  return '100 g';
}

export function toFoodItem(food: UsdaFood): FoodItem {
  const brand = food.brandName ?? food.brandOwner;
  return {
    id: `usda:${food.fdcId}`,
    name: food.description?.trim() || `USDA food ${food.fdcId}`,
    source: 'usda',
    servingLabel: servingLabel(food),
    calories: nutrient(food, NUTRIENT.energyKcal),
    proteinG: nutrient(food, NUTRIENT.protein),
    carbsG: nutrient(food, NUTRIENT.carbs),
    fatG: nutrient(food, NUTRIENT.fat),
    ...(brand ? { brand: brand.trim() } : {}),
    ...(nutrient(food, NUTRIENT.fiber) > 0 ? { fiberG: nutrient(food, NUTRIENT.fiber) } : {}),
  };
}

export function createUsdaClient(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): FoodDatabasePort {
  const apiKey = config.foodDatabase.usda.apiKey;
  const enabled = Boolean(apiKey);

  async function call<T>(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<T> {
    params.set('api_key', apiKey ?? '');
    const response = await fetchImpl(`${BASE}${path}?${params.toString()}`, {
      signal: signal ?? AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      // 429 is the shared per-IP quota. Distinguished in the message because the
      // remedy differs: wait, versus fix a bad key.
      const reason =
        response.status === 429
          ? 'the USDA rate limit was reached'
          : `USDA responded ${response.status}`;
      throw foodSourceUnavailable(`Could not reach the USDA food database — ${reason}.`);
    }
    return (await response.json()) as T;
  }

  return {
    source: 'usda',
    enabled,

    async search(query, signal) {
      if (!enabled) return [];
      try {
        const data = await call<{ foods?: UsdaFood[] }>(
          '/foods/search',
          new URLSearchParams({ query, pageSize: '25', dataType: 'Foundation,SR Legacy,Branded' }),
          signal,
        );
        return (data.foods ?? []).map(toFoodItem);
      } catch (error) {
        logger.warn({ err: error, query }, 'USDA search failed');
        throw error;
      }
    },

    async getItem(externalId, signal) {
      if (!enabled) return null;
      // Guard the path segment: externalId reaches here from a client-supplied id.
      if (!/^\d+$/.test(externalId)) return null;
      try {
        const food = await call<UsdaFood>(`/food/${externalId}`, new URLSearchParams(), signal);
        return toFoodItem(food);
      } catch (error) {
        logger.warn({ err: error, externalId }, 'USDA item lookup failed');
        return null;
      }
    },
  };
}
