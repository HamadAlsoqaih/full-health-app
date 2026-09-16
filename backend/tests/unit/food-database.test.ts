/**
 * Parsing tests for the external food databases.
 *
 * api.nal.usda.gov and world.openfoodfacts.org are both unreachable from the
 * build and CI environments, so `fetch` is injected and these run against
 * checked-in fixtures. Without this, the parsing code would ship untested.
 */
import { describe, expect, it, vi } from 'vitest';
import usdaSearch from '../fixtures/usda-search.json' with { type: 'json' };
import offProducts from '../fixtures/off-product.json' with { type: 'json' };
import {
  createUsdaClient,
  toFoodItem as usdaToFoodItem,
} from '../../src/services/nutrition/food-database/usda-client.js';
import {
  createOpenFoodFactsClient,
  toFoodItem as offToFoodItem,
} from '../../src/services/nutrition/food-database/open-food-facts-client.js';

/** A fetch that returns the given JSON, and records the URL it was called with. */
function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { impl: impl as unknown as typeof globalThis.fetch, calls };
}

describe('USDA parsing', () => {
  it('maps nutrients by their stable numbers, not their display names', () => {
    const food = usdaSearch.foods[0]!;
    const item = usdaToFoodItem(food);

    expect(item.id).toBe('usda:169705');
    expect(item.name).toBe('Oats, rolled, dry');
    expect(item.calories).toBe(379);
    expect(item.proteinG).toBe(13.2);
    expect(item.carbsG).toBe(67.7);
    expect(item.fatG).toBe(6.52);
    expect(item.fiberG).toBe(10.1);
  });

  it('states the serving basis, so a number is never shown without it', () => {
    expect(usdaToFoodItem(usdaSearch.foods[0]!).servingLabel).toBe('40 g');
    // No serving size given upstream, so it falls back to the documented default.
    expect(usdaToFoodItem(usdaSearch.foods[1]!).servingLabel).toBe('100 g');
  });

  it('trims names and prefers brand name over brand owner', () => {
    const item = usdaToFoodItem(usdaSearch.foods[1]!);
    expect(item.name).toBe('OAT MILK');
    expect(item.brand).toBe('Some Brand');
  });

  it('treats a missing nutrient as zero rather than crashing', () => {
    const item = usdaToFoodItem({ fdcId: 1, description: 'Mystery', foodNutrients: [] });
    expect(item.calories).toBe(0);
    expect(item.fiberG).toBeUndefined();
  });

  it('is disabled without an API key, and returns no results rather than throwing', async () => {
    // No USDA_FDC_API_KEY is set in the test environment.
    const { impl, calls } = stubFetch(usdaSearch);
    const client = createUsdaClient(impl);

    expect(client.enabled).toBe(false);
    expect(await client.search('oats')).toEqual([]);
    expect(await client.getItem('169705')).toBeNull();
    // Crucially, it never called out: a missing key must not produce a request.
    expect(calls).toHaveLength(0);
  });

  it('refuses a non-numeric item id rather than putting it in a URL path', async () => {
    const { impl, calls } = stubFetch({});
    const client = createUsdaClient(impl);
    expect(await client.getItem('../../etc/passwd')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('Open Food Facts parsing', () => {
  it('maps a complete product', () => {
    const item = offToFoodItem(offProducts.products[0]!);
    expect(item).not.toBeNull();
    expect(item!.id).toBe('off:3017620422003');
    expect(item!.name).toBe('Nutella');
    expect(item!.calories).toBe(539);
    // Only the first brand, not the raw comma-separated list.
    expect(item!.brand).toBe('Ferrero');
    // The basis is per 100g; the pack serving is extra context, not the basis.
    expect(item!.servingLabel).toBe('100 g (pack serving: 15 g)');
  });

  it('converts kilojoules when no kcal figure is present', () => {
    const item = offToFoodItem(offProducts.products[1]!);
    // 2092 kJ / 4.184 = 500 kcal
    expect(item!.calories).toBe(500);
  });

  it('drops a product with no usable energy figure instead of logging it as zero', () => {
    // This is the important one: a zero here becomes a silently wrong calorie
    // total in someone's food log.
    expect(offToFoodItem(offProducts.products[2]!)).toBeNull();
  });

  it('drops a product with no name', () => {
    expect(offToFoodItem(offProducts.products[3]!)).toBeNull();
  });

  it('filters unusable products out of a search rather than surfacing them', async () => {
    const { impl } = stubFetch(offProducts);
    const client = createOpenFoodFactsClient(impl);

    const results = await client.search('spread');
    // Four in the fixture, two of them unusable.
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(['off:3017620422003', 'off:1111111111111']);
  });

  it('identifies itself, as the upstream terms ask', async () => {
    const impl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('User-Agent')).toMatch(/FullHealthApp/);
      return new Response(JSON.stringify(offProducts), { status: 200 });
    });
    await createOpenFoodFactsClient(impl as unknown as typeof globalThis.fetch).search('x');
    expect(impl).toHaveBeenCalled();
  });

  it('surfaces an upstream error as an unavailable source, not as empty results', async () => {
    const { impl } = stubFetch({}, 503);
    const client = createOpenFoodFactsClient(impl);
    await expect(client.search('oats')).rejects.toMatchObject({
      code: 'FOOD_SOURCE_UNAVAILABLE',
    });
  });

  it('rejects an id that is not a plausible barcode', async () => {
    const { impl, calls } = stubFetch({});
    const client = createOpenFoodFactsClient(impl);
    expect(await client.getItem('abc')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
