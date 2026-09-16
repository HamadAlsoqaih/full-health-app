/**
 * Configuration.
 *
 * The single most important property of this module: it must NOT validate every
 * environment variable at import time. `npm run build` and `npm test` both run with
 * no credentials at all — in CI and on a fresh clone — and a boot-time
 * "throw if any key is missing" pattern would fail both.
 *
 * So: every third-party credential is optional, and each subsystem exposes an
 * `enabled` flag derived from whether its key is actually present. Code that truly
 * cannot work without a credential calls a `require*` accessor, which throws at the
 * point of use with a message naming the missing variable. A missing key degrades one
 * feature; it never takes down the process.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Loads backend/.env into process.env.
 *
 * This happens here, at the top of the module that reads the environment, so
 * every entrypoint gets it: the server, the exercise seed script, and anything
 * added later. Putting it in server.ts alone would leave the scripts unable to
 * see their own configuration.
 *
 * Several candidate paths are tried because this module runs from two different
 * places. From source it sits at backend/src/config/, so backend/.env is two
 * levels up; in the esbuild bundle it is backend/dist/server.js, where two
 * levels up is the repository root instead. Resolving a single relative path
 * would therefore work in development and silently read the wrong file — or
 * nothing at all — from a built artifact.
 *
 * The working directory is checked first, since npm sets it to the workspace
 * root for workspace scripts and that is what a developer running the app
 * expects to win.
 *
 * Two deliberate behaviours:
 *
 * - Existing variables win. dotenv does not override what is already set, so a
 *   host that injects real configuration (Render, CI) is unaffected by a stray
 *   .env that shipped in an image.
 *
 * - Skipped entirely under NODE_ENV=test. The suite's whole premise is that it
 *   passes with no credentials; letting a developer's real .env bleed in would
 *   quietly change what the tests exercise on their machine versus in CI.
 */
function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'test') return;

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), '.env'), // npm workspace script: cwd is backend/
    resolve(here, '../../.env'), // from source: backend/src/config/
    resolve(here, '../.env'), // from the bundle: backend/dist/
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    // A missing .env is normal in production, where the host supplies the
    // variables directly — so this is not an error and not worth a warning.
    dotenv.config({ path, quiet: true });
    return;
  }
}

loadDotEnv();

/**
 * Treats an empty string as "not set".
 *
 * This is load-bearing, not tidiness. `.optional()` only accepts `undefined`, so
 * a variable that is PRESENT BUT BLANK — exactly what you get from copying
 * .env.example, where every optional key is listed with no value — would fail
 * `.min(1)` and throw at import time. That would crash the process on boot over
 * an unset optional key, which is the precise opposite of this module's whole
 * premise: a missing credential must degrade one feature, never stop the app.
 *
 * Applied to defaulted fields too, so a blanked-out numeric falls back to its
 * default instead of coercing to 0 and failing a `.positive()` check.
 */
const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

const rawSchema = z.object({
  NODE_ENV: blank(z.enum(['development', 'test', 'production']).default('development')),
  PORT: blank(z.coerce.number().int().positive().default(8080)),
  LOG_LEVEL: blank(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: blank(z.string().default('http://localhost:5173')),

  // Supabase. The anon key is used with the caller's JWT so row-level security
  // applies; the service-role key bypasses RLS and is confined to the few
  // operations that have no user JWT. See config/supabaseAdmin.ts.
  SUPABASE_URL: blank(z.string().url().optional()),
  SUPABASE_ANON_KEY: blank(z.string().min(1).optional()),
  SUPABASE_SERVICE_ROLE_KEY: blank(z.string().min(1).optional()),

  // AI. 'stub' is a real, deterministic provider used by tests and by any
  // deployment without a key — not a placeholder that throws.
  AI_PROVIDER: blank(z.enum(['gemini', 'groq', 'stub']).default('stub')),
  GEMINI_API_KEY: blank(z.string().min(1).optional()),
  GEMINI_MODEL: blank(z.string().default('gemini-2.5-flash')),
  GROQ_API_KEY: blank(z.string().min(1).optional()),
  GROQ_MODEL: blank(z.string().default('llama-3.3-70b-versatile')),
  /**
   * Account-wide daily ceiling on AI vision calls. The upstream free-tier quota is
   * shared by every user of this deployment, so without a global counter one user
   * can exhaust the whole app's allowance.
   */
  AI_VISION_DAILY_LIMIT: blank(z.coerce.number().int().positive().default(1200)),

  USDA_FDC_API_KEY: blank(z.string().min(1).optional()),

  SENTRY_DSN: blank(z.string().min(1).optional()),
  SENTRY_TRACES_SAMPLE_RATE: blank(z.coerce.number().min(0).max(1).default(0)),

  ONESIGNAL_APP_ID: blank(z.string().min(1).optional()),
  ONESIGNAL_API_KEY: blank(z.string().min(1).optional()),

  /** Upload ceiling for meal photos, bytes. Unbounded multipart is a trivial DoS. */
  PHOTO_MAX_BYTES: blank(
    z.coerce
      .number()
      .int()
      .positive()
      .default(8 * 1024 * 1024),
  ),
});

export type RawEnv = z.infer<typeof rawSchema>;

function parseEnv(source: NodeJS.ProcessEnv): RawEnv {
  const parsed = rawSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  // A malformed value (a non-numeric PORT, an unknown AI_PROVIDER) is a genuine
  // misconfiguration and worth failing on. A *missing* optional key is not.
  const issues = parsed.error.issues
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration — ${issues}`);
}

const env = parseEnv(process.env);

/** Built rather than thrown, so callers `throw missing(name)` and TypeScript narrows. */
function missing(name: string): Error {
  return new Error(
    `${name} is not configured. This operation requires it. See docs/SETUP.md for where to obtain it.`,
  );
}

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export const config = {
  env: env.NODE_ENV,
  isTest: env.NODE_ENV === 'test',
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  supabase: {
    /** True when the app can talk to Supabase at all. */
    enabled: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    /** Throws at point of use rather than at import. */
    require(): SupabaseConfig {
      if (!env.SUPABASE_URL) throw missing('SUPABASE_URL');
      if (!env.SUPABASE_ANON_KEY) throw missing('SUPABASE_ANON_KEY');
      return { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };
    },
    requireServiceRoleKey(): string {
      if (!env.SUPABASE_SERVICE_ROLE_KEY) throw missing('SUPABASE_SERVICE_ROLE_KEY');
      return env.SUPABASE_SERVICE_ROLE_KEY;
    },
  },

  ai: {
    /**
     * Falls back to the stub whenever the selected provider has no key, so a
     * keyless environment gets deterministic output instead of a runtime failure.
     */
    provider: ((): 'gemini' | 'groq' | 'stub' => {
      if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) return 'stub';
      if (env.AI_PROVIDER === 'groq' && !env.GROQ_API_KEY) return 'stub';
      return env.AI_PROVIDER;
    })(),
    requestedProvider: env.AI_PROVIDER,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL,
    visionDailyLimit: env.AI_VISION_DAILY_LIMIT,
  },

  foodDatabase: {
    usda: {
      /** Without a key the USDA source is skipped, not fatal: cache and custom foods still serve. */
      enabled: Boolean(env.USDA_FDC_API_KEY),
      apiKey: env.USDA_FDC_API_KEY,
    },
    /** Open Food Facts needs no key, so it is always available in principle. */
    openFoodFacts: { enabled: true },
    /** A cached upstream result older than this is treated as a miss. */
    cacheTtlDays: 30,
  },

  sentry: {
    enabled: Boolean(env.SENTRY_DSN),
    dsn: env.SENTRY_DSN,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  },

  notifications: {
    enabled: Boolean(env.ONESIGNAL_APP_ID && env.ONESIGNAL_API_KEY),
    appId: env.ONESIGNAL_APP_ID,
    apiKey: env.ONESIGNAL_API_KEY,
  },

  uploads: {
    photoMaxBytes: env.PHOTO_MAX_BYTES,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  },

  /** How long a pending AI evaluation may sit before the reaper re-fires it. */
  evaluation: {
    staleAfterMs: 2 * 60 * 1000,
    maxAttempts: 3,
    providerTimeoutMs: 20_000,
  },
} as const;

export type Config = typeof config;
