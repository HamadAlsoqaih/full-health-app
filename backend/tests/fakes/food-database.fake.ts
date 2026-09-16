/**
 * In-memory FoodDatabasePort.
 *
 * `calls` is recorded so a test can assert the cache-first rule actually holds:
 * a cache hit must leave this at zero (spec rule 6).
 */
import type { FoodItem } from '@app/shared-types';
import type { FoodDatabasePort } from '../../src/ports.js';

export interface FakeFoodDatabase extends FoodDatabasePort {
  readonly calls: { search: string[]; getItem: string[] };
  setItems(items: FoodItem[]): void;
  /** Simulates an upstream outage, so the degraded path can be tested. */
  failNext(error?: Error): void;
}

export function createFakeFoodDatabase(
  source: 'usda' | 'open-food-facts' = 'usda',
  initial: FoodItem[] = [],
): FakeFoodDatabase {
  let items = [...initial];
  let nextError: Error | null = null;
  const calls = { search: [] as string[], getItem: [] as string[] };

  const takeError = () => {
    if (!nextError) return;
    const err = nextError;
    nextError = null;
    throw err;
  };

  return {
    source,
    enabled: true,
    calls,
    setItems(next) {
      items = [...next];
    },
    failNext(error = new Error('fake upstream failure')) {
      nextError = error;
    },
    async search(query) {
      calls.search.push(query);
      takeError();
      const q = query.toLowerCase();
      return items.filter((i) => i.name.toLowerCase().includes(q));
    },
    async getItem(externalId) {
      calls.getItem.push(externalId);
      takeError();
      return (
        items.find((i) => i.id === `${source === 'usda' ? 'usda' : 'off'}:${externalId}`) ?? null
      );
    },
  };
}
