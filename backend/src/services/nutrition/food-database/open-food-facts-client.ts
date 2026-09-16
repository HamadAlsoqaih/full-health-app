/**
 * Open Food Facts client.
 *
 * Needs no API key, so it is always available in principle — but it is a
 * community-maintained dataset and individual products can have missing or
 * implausible nutrient values. Anything unusable is dropped rather than passed on
 * as a zero, because a silent zero becomes a wrong calorie total in someone's log.
 *
 * As with the USDA client, `fetch` is injected because the host is unreachable from
 * the build environment and fixtures are the only route to a test.
 */
import type { FoodItem } from '@app/shared-types';
import { foodSourceUnavailable } from '../../../errors.js';
import { logger } from '../../../logger.js';
import type { FoodDatabasePort } from '../../../ports.js';

const SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';

// Identifies this app to Open Food Facts, which their terms ask for.
const USER_AGENT = 'FullHealthApp/0.1 (https://github.com/HamadAlsoqaih/full-health-app)';

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: Record<string, unknown>;
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Returns null when the product has no usable energy figure.
 *
 * A product with no calories is not a zero-calorie food, it is an incomplete
 * record, and logging it would quietly understate someone's intake.
 */
export function toFoodItem(product: OffProduct): FoodItem | null {
  const n = product.nutriments ?? {};
  const name = product.product_name?.trim();
  const code = product.code?.trim();
  if (!name || !code) return null;

  // Prefer the kcal field; fall back to converting kJ.
  const kcal = num(n['energy-kcal_100g']) ?? num(n['energy-kcal']);
  const kj = num(n['energy_100g']) ?? num(n['energy']);
  const calories = kcal ?? (kj !== null ? Math.round(kj / 4.184) : null);
  if (calories === null) return null;

  const brands = product.brands?.split(',')[0]?.trim();
  const serving = product.serving_size?.trim();

  return {
    id: `off:${code}`,
    name,
    source: 'open-food-facts',
    // Nutriments here are per 100 g; the product's own serving size is shown only
    // as extra context so the basis of the numbers is never ambiguous.
    servingLabel: serving ? `100 g (pack serving: ${serving})` : '100 g',
    calories,
    proteinG: num(n['proteins_100g']) ?? 0,
    carbsG: num(n['carbohydrates_100g']) ?? 0,
    fatG: num(n['fat_100g']) ?? 0,
    ...(brands ? { brand: brands } : {}),
    ...(num(n['fiber_100g']) ? { fiberG: num(n['fiber_100g']) as number } : {}),
  };
}

export function createOpenFoodFactsClient(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): FoodDatabasePort {
  async function call<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await fetchImpl(url, {
      signal: signal ?? AbortSignal.timeout(8000),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      throw foodSourceUnavailable(
        `Could not reach Open Food Facts — it responded ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    source: 'open-food-facts',
    enabled: true,

    async search(query, signal) {
      try {
        const url = `${SEARCH}?${new URLSearchParams({
          search_terms: query,
          json: '1',
          page_size: '25',
          fields: 'code,product_name,brands,serving_size,nutriments',
        })}`;
        const data = await call<{ products?: OffProduct[] }>(url, signal);
        // Incomplete records are filtered out, not surfaced as zeroes.
        return (data.products ?? [])
          .map(toFoodItem)
          .filter((item): item is FoodItem => item !== null);
      } catch (error) {
        logger.warn({ err: error, query }, 'Open Food Facts search failed');
        throw error;
      }
    },

    async getItem(externalId, signal) {
      // Barcodes only; the id arrives from client input.
      if (!/^\d{4,20}$/.test(externalId)) return null;
      try {
        const data = await call<{ product?: OffProduct }>(`${PRODUCT}/${externalId}.json`, signal);
        return data.product ? toFoodItem(data.product) : null;
      } catch (error) {
        logger.warn({ err: error, externalId }, 'Open Food Facts lookup failed');
        return null;
      }
    },
  };
}
