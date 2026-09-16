/**
 * Configuration parsing.
 *
 * The case this exists for: a variable that is PRESENT BUT BLANK.
 *
 * Copying .env.example to .env leaves every optional key listed with no value,
 * and zod's `.optional()` only accepts `undefined` — so `GEMINI_API_KEY=` fails
 * `.min(1)` and throws at import time. That crashed the process on boot over an
 * unset optional key, which is the exact opposite of this module's premise.
 *
 * It was invisible to the rest of the suite because those tests run with no env
 * vars at all, where `.optional()` behaves. So these tests set blanks explicitly.
 *
 * config/index.ts reads process.env once at module load, so each case re-imports
 * it with a reset module registry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/config/index.js';

const ORIGINAL = { ...process.env };

/** Loads config fresh under a given environment. */
async function loadConfig(env: Record<string, string | undefined>): Promise<Config> {
  vi.resetModules();
  process.env = { ...ORIGINAL, ...env };
  const module = await import('../../src/config/index.js');
  return module.config;
}

/** Every optional key blank, as a copied .env.example leaves them. */
const ALL_BLANK = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  GEMINI_API_KEY: '',
  GROQ_API_KEY: '',
  USDA_FDC_API_KEY: '',
  SENTRY_DSN: '',
  ONESIGNAL_APP_ID: '',
  ONESIGNAL_API_KEY: '',
};

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe('blank values are treated as unset', () => {
  it('does not throw when every optional key is present but empty', async () => {
    // The regression. Previously this threw:
    //   "Invalid environment configuration — GEMINI_API_KEY: Too small…"
    await expect(loadConfig(ALL_BLANK)).resolves.toBeDefined();
  });

  it('reports each subsystem as disabled rather than failing', async () => {
    const config = await loadConfig(ALL_BLANK);

    expect(config.supabase.enabled).toBe(false);
    expect(config.foodDatabase.usda.enabled).toBe(false);
    expect(config.sentry.enabled).toBe(false);
    expect(config.notifications.enabled).toBe(false);
  });

  it('falls back to the stub AI provider when the selected provider has a blank key', async () => {
    const config = await loadConfig({ ...ALL_BLANK, AI_PROVIDER: 'gemini' });

    // A keyless deployment gets deterministic output, not a runtime failure.
    expect(config.ai.provider).toBe('stub');
    expect(config.ai.requestedProvider).toBe('gemini');
  });

  it('applies defaults when a defaulted numeric is blanked out', async () => {
    // '' coerces to 0, which would fail .positive() without the blank handling.
    const config = await loadConfig({
      ...ALL_BLANK,
      PORT: '',
      PHOTO_MAX_BYTES: '',
      AI_VISION_DAILY_LIMIT: '',
      SENTRY_TRACES_SAMPLE_RATE: '',
    });

    expect(config.port).toBe(8080);
    expect(config.uploads.photoMaxBytes).toBe(8 * 1024 * 1024);
    expect(config.ai.visionDailyLimit).toBe(1200);
    expect(config.sentry.tracesSampleRate).toBe(0);
  });

  it('applies defaults when a defaulted string or enum is blanked out', async () => {
    const config = await loadConfig({
      ...ALL_BLANK,
      LOG_LEVEL: '',
      CORS_ORIGINS: '',
      AI_PROVIDER: '',
    });

    expect(config.logLevel).toBe('info');
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
    expect(config.ai.provider).toBe('stub');
  });

  it('treats whitespace as blank too', async () => {
    const config = await loadConfig({ ...ALL_BLANK, USDA_FDC_API_KEY: '   ' });
    expect(config.foodDatabase.usda.enabled).toBe(false);
  });
});

describe('real values are honoured', () => {
  it('enables each subsystem when its key is set', async () => {
    const config = await loadConfig({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-key',
      USDA_FDC_API_KEY: 'usda-key',
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      ONESIGNAL_APP_ID: 'app-id',
      ONESIGNAL_API_KEY: 'rest-key',
    });

    expect(config.supabase.enabled).toBe(true);
    expect(config.ai.provider).toBe('gemini');
    expect(config.foodDatabase.usda.enabled).toBe(true);
    expect(config.sentry.enabled).toBe(true);
    expect(config.notifications.enabled).toBe(true);
  });

  it('splits and trims CORS_ORIGINS', async () => {
    const config = await loadConfig({
      ...ALL_BLANK,
      CORS_ORIGINS: 'https://a.example , https://b.example',
    });
    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('requires both Supabase values before reporting itself enabled', async () => {
    const urlOnly = await loadConfig({ ...ALL_BLANK, SUPABASE_URL: 'https://x.supabase.co' });
    expect(urlOnly.supabase.enabled).toBe(false);

    const keyOnly = await loadConfig({ ...ALL_BLANK, SUPABASE_ANON_KEY: 'anon' });
    expect(keyOnly.supabase.enabled).toBe(false);
  });
});

describe('genuinely malformed values still fail fast', () => {
  it('rejects a non-numeric PORT', async () => {
    // A typo is a real misconfiguration and worth refusing to start over —
    // unlike an unset optional key.
    await expect(loadConfig({ ...ALL_BLANK, PORT: 'not-a-number' })).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects an unknown AI_PROVIDER', async () => {
    await expect(loadConfig({ ...ALL_BLANK, AI_PROVIDER: 'openai' })).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a malformed SUPABASE_URL', async () => {
    await expect(loadConfig({ ...ALL_BLANK, SUPABASE_URL: 'not-a-url' })).rejects.toThrow(
      /Invalid environment configuration/,
    );
  });
});

describe('require accessors throw at point of use, not at import', () => {
  it('throws a message naming the missing variable', async () => {
    const config = await loadConfig(ALL_BLANK);

    // Importing succeeded above; only using it fails.
    expect(() => config.supabase.require()).toThrow(/SUPABASE_URL/);
    expect(() => config.supabase.requireServiceRoleKey()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('points at the setup documentation', async () => {
    const config = await loadConfig(ALL_BLANK);
    expect(() => config.supabase.require()).toThrow(/docs\/SETUP\.md/);
  });
});
