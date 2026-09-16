// Sentry must be initialised before anything else is imported or instrumented.
import { initSentry } from './sentry.js';

initSentry();

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config/index.js';
import { logger } from './logger.js';
import type { AppDeps } from './ports.js';
import { createRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.middleware.js';

/**
 * Builds the Express app from an explicit dependency set.
 *
 * Separated from server.ts, which owns `listen`, so an integration test can build
 * a fully wired app with in-memory fakes and drive it through supertest without
 * binding a port or needing a single credential.
 */
export function createApp(deps: AppDeps): Express {
  const app = express();

  // Render terminates TLS upstream, so without this req.ip is the proxy's address
  // and every rate limit collapses into one shared bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON only; a CSP here would apply to nothing it returns.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      // Lets the browser read the replay marker on an idempotent write.
      exposedHeaders: ['Idempotent-Replay'],
    }),
  );

  if (!config.isTest) {
    app.use(
      pinoHttp({
        logger,
        // Health checks are hit constantly by the host's own monitor.
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }

  app.use(express.json({ limit: '256kb' }));

  /**
   * Unauthenticated and deliberately uninformative: it reports that the process is
   * up, not whether any dependency is configured. The free hosting tier sleeps when
   * idle, so this is also what a warm-up ping hits.
   */
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', env: config.env });
  });

  app.use('/api', createRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
