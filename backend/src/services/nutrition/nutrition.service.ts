/**
 * Food search and logging.
 *
 * Two things here carry most of the weight:
 *
 * 1. **Cache-first search** (spec rule 6). Every external lookup checks
 *    food_cache first, and a hit does not touch the upstream API at all. This is
 *    not only about latency: both upstream quotas are shared across the whole
 *    deployment, so an uncached search spends a budget that belongs to every user.
 *
 * 2. **One resolution path for five sources.** `foodItemId` is namespaced
 *    (`usda:`, `off:`, `custom:`, `estimate:`, `manual:`), so logging a USDA food,
 *    a barcode product, the user's own recipe and an AI estimate all follow the
 *    same code path. The server resolves macros itself; the client never supplies
 *    them, because a client-supplied calorie count is unverifiable.
 */
import type {
  CustomFood,
  DailyNutritionTotals,
  FoodItem,
  FoodLogEntry,
  FoodLogInput,
  FoodSource,
  NutritionSearchResult,
} from '@app/shared-types';
import { config } from '../../config/index.js';
import { badRequest, foodSourceUnavailable, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import type { FoodDatabasePort } from '../../ports.js';
import type { NewFoodLogRow, Repositories } from '../../repositories/index.js';
import { insertIdempotent } from '../offline-write.js';

/** Search terms are normalised so trivial variations share a cache entry. */
const cacheKey = (query: string): string => query.trim().toLowerCase().replace(/\s+/g, ' ');

const customFoodToItem = (food: CustomFood): FoodItem => ({
  id: `custom:${food.id}`,
  name: food.name,
  source: 'custom',
  servingLabel: food.servingLabel,
  calories: food.calories,
  proteinG: food.proteinG,
  carbsG: food.carbsG,
  fatG: food.fatG,
  ...(food.brand ? { brand: food.brand } : {}),
  ...(food.fiberG !== undefined ? { fiberG: food.fiberG } : {}),
});

/**
 * Searches the user's own foods and every enabled external source.
 *
 * A source that fails is reported in `unavailableSources` rather than failing the
 * whole search — one upstream outage should not hide the results from the others,
 * or the user's own foods.
 */
export async function searchFoods(
  repos: Repositories,
  databases: FoodDatabasePort[],
  userId: string,
  query: string,
): Promise<NutritionSearchResult> {
  const key = cacheKey(query);
  const items: FoodItem[] = [];
  const unavailableSources: FoodSource[] = [];
  let anyUpstreamCallMade = false;

  // The user's own foods always come first: they are the most likely intent and
  // need no network at all.
  items.push(...(await repos.customFoods.search(userId, query)).map(customFoodToItem));

  for (const db of databases) {
    if (!db.enabled) {
      unavailableSources.push(db.source);
      continue;
    }

    const cached = await repos.foodCache.get('search', db.source, key);
    if (cached) {
      items.push(...(cached.payload as FoodItem[]));
      continue;
    }

    try {
      anyUpstreamCallMade = true;
      const results = await db.search(query);
      items.push(...results);
      // Cached even when empty, so a fruitless search is not repeated upstream.
      await repos.foodCache.put({
        kind: 'search',
        source: db.source,
        query: key,
        userId: null,
        payload: results,
      });
    } catch (error) {
      logger.warn({ err: error, source: db.source }, 'food search source unavailable');
      unavailableSources.push(db.source);
    }
  }

  return {
    query,
    items,
    fromCache: !anyUpstreamCallMade,
    unavailableSources,
  };
}

/**
 * Resolves a namespaced food id to its per-serving macros.
 *
 * Deliberately throws rather than guessing when a source cannot be reached: a
 * fabricated macro figure silently corrupts the user's log and, through it, the
 * trend analysis.
 */
export async function resolveFoodItem(
  repos: Repositories,
  databases: FoodDatabasePort[],
  userId: string,
  foodItemId: string,
): Promise<FoodItem> {
  const separator = foodItemId.indexOf(':');
  if (separator < 0) throw badRequest('foodItemId must be namespaced, e.g. usda:12345.');

  const prefix = foodItemId.slice(0, separator);
  const rest = foodItemId.slice(separator + 1);

  switch (prefix) {
    case 'custom': {
      // User-scoped: without this, one user could log — and read the macros of —
      // another user's custom food by id.
      const food = await repos.customFoods.findById(userId, rest);
      if (!food) throw notFound('That custom food no longer exists.');
      return customFoodToItem(food);
    }

    case 'estimate': {
      // Written by the photo-scan endpoint, so the confirmation step has a
      // server-side record and the client does not have to send back macros the
      // server cannot verify.
      const estimate = await repos.foodCache.getEstimate(userId, foodItemId);
      if (!estimate) {
        throw notFound('That photo estimate has expired. Scan the meal again.');
      }
      return estimate;
    }

    case 'manual':
      // A manual entry carries no upstream record; the caller supplies the macros
      // through the custom-food path instead.
      throw badRequest('Create a custom food to log a manual entry.');

    case 'usda':
    case 'off': {
      const source: FoodSource = prefix === 'usda' ? 'usda' : 'open-food-facts';

      const cached = await repos.foodCache.get('item', source, rest);
      if (cached) return cached.payload as FoodItem;

      const db = databases.find((d) => d.source === source);
      if (!db?.enabled) {
        throw foodSourceUnavailable(
          'That food source is not available right now, and it is not cached. Try again later or add it as a custom food.',
        );
      }

      const item = await db.getItem(rest);
      if (!item) throw notFound('That food could not be found.');

      await repos.foodCache.put({
        kind: 'item',
        source,
        query: rest,
        userId: null,
        payload: item,
      });
      return item;
    }

    default:
      throw badRequest(`Unknown food source "${prefix}".`);
  }
}

export async function logFood(
  repos: Repositories,
  databases: FoodDatabasePort[],
  userId: string,
  input: FoodLogInput,
): Promise<{ row: FoodLogEntry; replayed: boolean }> {
  // Resolved before the insert, so a bad id is a 4xx rather than a half-written row.
  const item = await resolveFoodItem(repos, databases, userId, input.foodItemId);

  const row: NewFoodLogRow = {
    clientId: input.clientId,
    date: input.date,
    foodItemId: input.foodItemId,
    // Snapshot: without it, deleting a custom food makes past days unreadable.
    foodName: item.name,
    source: item.source,
    servingLabel: item.servingLabel,
    servingMultiplier: input.servingMultiplier,
    baseCalories: item.calories,
    baseProteinG: item.proteinG,
    baseCarbsG: item.carbsG,
    baseFatG: item.fatG,
    ...(input.meal ? { meal: input.meal } : {}),
  };

  return insertIdempotent(
    () => repos.foodLog.insert(userId, row),
    () => repos.foodLog.findByClientId(userId, input.clientId),
  );
}

export async function getDailyLog(
  repos: Repositories,
  userId: string,
  date: string,
): Promise<FoodLogEntry[]> {
  return repos.foodLog.listByDate(userId, date);
}

export function totalsFor(date: string, entries: FoodLogEntry[]): DailyNutritionTotals {
  return entries.reduce<DailyNutritionTotals>(
    (acc, e) => ({
      date,
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
      entryCount: acc.entryCount + 1,
    }),
    { date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, entryCount: 0 },
  );
}

export async function deleteLogEntry(
  repos: Repositories,
  userId: string,
  id: string,
): Promise<void> {
  await repos.foodLog.remove(userId, id);
}

/** Exposed so the cache TTL is applied consistently by the repository layer. */
export const CACHE_TTL_DAYS = config.foodDatabase.cacheTtlDays;
