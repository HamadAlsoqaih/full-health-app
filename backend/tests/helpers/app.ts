/**
 * Builds a fully wired app backed entirely by in-memory fakes.
 *
 * This is the payoff of the ports seam: an integration test drives the real
 * Express app, the real middleware chain, the real controllers and the real
 * services, with no Supabase project, no API keys and no network access.
 *
 * Time and ids are fixed by default so assertions can be exact.
 */
import { createApp } from '../../src/app.js';
import type { AiProvider, AppDeps } from '../../src/ports.js';
import { createStubAiProvider } from '../../src/services/ai/providers/stub.provider.js';
import { createFakeAuth, type FakeAuth } from '../fakes/auth.fake.js';
import { createFakeFoodDatabase, type FakeFoodDatabase } from '../fakes/food-database.fake.js';
import { createFakeNotifications, type FakeNotifications } from '../fakes/notifications.fake.js';
import {
  createFakeRepositories,
  createFakeStore,
  type FakeStore,
} from '../fakes/repositories.fake.js';
import type { FoodItem } from '@app/shared-types';

export interface TestHarness {
  app: ReturnType<typeof createApp>;
  store: FakeStore;
  auth: FakeAuth;
  foodDb: FakeFoodDatabase;
  notifications: FakeNotifications;
  deps: AppDeps;
  /** Moves the injected clock forward, for staleness and reaper tests. */
  advance(ms: number): void;
  /** Seeds an auth user AND its public profile row, returning a usable token. */
  seedUser(email?: string): { id: string; token: string };
}

export interface HarnessOptions {
  now?: Date;
  ai?: AiProvider;
  foodDbItems?: FoodItem[];
}

export function createTestHarness(options: HarnessOptions = {}): TestHarness {
  let current = options.now ?? new Date('2026-03-01T12:00:00.000Z');
  const clock = () => current;

  // Sequential rather than random, so a failing assertion names a predictable id.
  let counter = 0;
  const uuid = () => {
    counter += 1;
    return `00000000-0000-4000-8000-${counter.toString().padStart(12, '0')}`;
  };

  const store = createFakeStore();
  const auth = createFakeAuth(uuid);
  const foodDb = createFakeFoodDatabase('usda', options.foodDbItems ?? []);
  const notifications = createFakeNotifications();

  const deps: AppDeps = {
    auth,
    repositories: (ctx) => createFakeRepositories(store, ctx),
    ai: options.ai ?? createStubAiProvider(uuid),
    foodDatabases: [foodDb],
    notifications,
    clock,
    uuid,
  };

  const app = createApp(deps);

  return {
    app,
    store,
    auth,
    foodDb,
    notifications,
    deps,
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
    seedUser(email) {
      const user = auth.seedUser(email ?? `user-${counter + 1}@example.com`);
      store.users.push({
        id: user.id,
        email: user.email,
        displayName: null,
        onboardingComplete: false,
        goals: null,
        units: 'metric',
        preferences: {},
        createdAt: clock().toISOString(),
        updatedAt: clock().toISOString(),
      });
      return { id: user.id, token: auth.tokenFor(user.id) };
    },
  };
}
