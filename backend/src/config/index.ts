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
import { z } from 'zod';

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  // Supabase. The anon key is used with the caller's JWT so row-level security
  // applies; the service-role key bypasses RLS and is confined to the few
  // operations that have no user JWT. See config/supabaseAdmin.ts.
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // AI. 'stub' is a real, deterministic provider used by tests and by any
  // deployment without a key — not a placeholder that throws.
  AI_PROVIDER: z.enum(['gemini', 'groq', 'stub']).default('stub'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GROQ_API_KEY: z.string().min(1).optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  /**
   * Account-wide daily ceiling on AI vision calls. The upstream free-tier quota is
   * shared by every user of this deployment, so without a global counter one user
   * can exhaust the whole app's allowance.
   */
  AI_VISION_DAILY_LIMIT: z.coerce.number().int().positive().default(1200),

  USDA_FDC_API_KEY: z.string().min(1).optional(),

  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  ONESIGNAL_APP_ID: z.string().min(1).optional(),
  ONESIGNAL_API_KEY: z.string().min(1).optional(),

  /** Upload ceiling for meal photos, bytes. Unbounded multipart is a trivial DoS. */
  PHOTO_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),
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
