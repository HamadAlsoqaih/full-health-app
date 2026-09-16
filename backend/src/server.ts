/**
 * Runtime entrypoint. Builds the real dependency set and listens.
 *
 * Kept separate from app.ts so tests can construct an app with fakes without
 * binding a port.
 */
import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './logger.js';
import { createSupabaseAuth } from './services/auth/auth.service.js';
import { createAiProvider } from './services/ai/ai.service.js';
import { createUsdaClient } from './services/nutrition/food-database/usda-client.js';
import { createOpenFoodFactsClient } from './services/nutrition/food-database/open-food-facts-client.js';
import {
  createDisabledNotifications,
  createOneSignalClient,
} from './services/notifications/onesignal.client.js';
import { createSupabaseRepositories } from './repositories/supabase/index.js';
import type { AppDeps } from './ports.js';

function buildDeps(): AppDeps {
  const uuid = () => crypto.randomUUID();

  return {
    auth: createSupabaseAuth(),
    repositories: createSupabaseRepositories,
    ai: createAiProvider(uuid),
    // Order matters: the USDA set is better curated, so it is offered first.
    foodDatabases: [createUsdaClient(), createOpenFoodFactsClient()],
    notifications: config.notifications.enabled
      ? createOneSignalClient()
      : createDisabledNotifications(),
    clock: () => new Date(),
    uuid,
  };
}

function main(): void {
  // Checked here rather than at import time so `npm run build` and the test suite
  // work with no credentials. Failing at startup with a pointer to the setup docs
  // is far more useful than a confusing error on the first request.
  if (!config.supabase.enabled) {
    logger.error(
      'SUPABASE_URL and SUPABASE_ANON_KEY are required to run the API. See docs/SETUP.md.',
    );
    process.exit(1);
  }

  const app = createApp(buildDeps());

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        env: config.env,
        aiProvider: config.ai.provider,
        notifications: config.notifications.enabled,
        sentry: config.sentry.enabled,
        usda: config.foodDatabase.usda.enabled,
      },
      'API listening',
    );
  });

  // The host stops a container with SIGTERM; draining avoids cutting off a
  // request that is mid-flight.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
    // Backstop, in case a connection refuses to close.
    setTimeout(() => process.exit(0), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
