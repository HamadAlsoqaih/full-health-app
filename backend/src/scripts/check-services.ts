/**
 * Calls every real external service once and reports pass or fail.
 *
 * This exists because of a gap that cost real debugging time. The test suite
 * runs with no credentials and no network — deliberately, so it passes on a
 * fresh clone and in CI — which means every fault that only appears when a real
 * server answers is invisible to it. Three such faults shipped:
 *
 *   - Supabase rejected the profile write on signup, because the client carried
 *     no JWT and row-level security refused it.
 *   - Gemini returned 404: the pinned model had been retired for new API keys.
 *   - Neither showed up in 250 passing tests.
 *
 * Reading the code does not catch these. Only asking the real service does. So
 * this script asks, on the machine that actually holds the credentials, and
 * prints one line per service.
 *
 * It is a diagnostic, not a test: it needs credentials and network, so it is
 * never part of `npm test` or CI.
 *
 *   npm run check:services --workspace backend
 *
 * Exit code is 0 when everything configured works, 1 otherwise — so it can gate
 * a deploy if you want it to. A service with no credentials is SKIP, not a
 * failure: the app is built to run without any of these.
 */
import { deflateSync } from 'node:zlib';
import { config } from '../config/index.js';
import { createUsdaClient } from '../services/nutrition/food-database/usda-client.js';
import { createOpenFoodFactsClient } from '../services/nutrition/food-database/open-food-facts-client.js';
import { createGeminiProvider } from '../services/ai/providers/gemini.provider.js';
import { createGroqProvider } from '../services/ai/providers/groq.provider.js';
import type { ComputedTrend } from '@app/shared-types';

type Outcome = 'PASS' | 'FAIL' | 'SKIP';

interface Result {
  name: string;
  outcome: Outcome;
  detail: string;
  /** Milliseconds the call took, for the ones that ran. */
  ms?: number;
}

const results: Result[] = [];

/** Runs one check, turning any throw into a FAIL with the real message. */
async function check(
  name: string,
  configured: boolean,
  missing: string,
  run: () => Promise<string>,
): Promise<void> {
  if (!configured) {
    results.push({ name, outcome: 'SKIP', detail: `not configured (${missing})` });
    return;
  }

  const started = Date.now();
  try {
    const detail = await run();
    results.push({ name, outcome: 'PASS', detail, ms: Date.now() - started });
  } catch (error) {
    // The provider's own message is what identifies the fault — a retired
    // model, a rejected key, a policy violation — so it is printed verbatim
    // rather than summarised.
    results.push({
      name,
      outcome: 'FAIL',
      detail: messageOf(error),
      ms: Date.now() - started,
    });
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    // AppError wraps the upstream error as `cause`; that inner message is the
    // one that names the actual problem.
    const cause = (error as Error & { details?: { cause?: unknown } }).details?.cause;
    const inner = cause instanceof Error ? ` — ${cause.message}` : '';
    return `${error.message}${inner}`.replace(/\s+/g, ' ').trim();
  }
  return String(error);
}

/** Fails a promise that hangs, so one dead host cannot stall the whole run. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms (${label})`)), ms).unref(),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// A tiny real image, for the vision check
// ---------------------------------------------------------------------------

/**
 * An 8x8 solid PNG, built here rather than committed as a fixture.
 *
 * The vision endpoint has to be sent actual image bytes; what the image shows
 * does not matter, only that the request is accepted and answered. Eight pixels
 * keeps the upload trivial.
 */
function tinyPng(): Buffer {
  const size = 8;
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  const crc32 = (buffer: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size, 0x80);
  for (let y = 0; y < size; y += 1) raw[y * (stride + 1)] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A plausible trend, for the text-generation checks. */
const SAMPLE_TREND: ComputedTrend = {
  status: 'ok',
  fromDate: '2026-08-01',
  toDate: '2026-08-31',
  days: 30,
  startWeightKg: 84,
  endWeightKg: 82.8,
  weightChangeKg: -1.2,
  ratePerWeekKg: -0.28,
  direction: 'losing',
  avgDailyCalories: 2050,
  avgDailyProteinG: 155,
  daysWithFoodLogs: 24,
  estimatedMaintenanceCalories: 2400,
  recommendation: {
    action: 'hold-calories',
    secondaryActions: [],
    calorieDeltaPerDay: 0,
    proteinTargetG: 160,
    rationale: 'Losing close to the target rate.',
  },
};

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Calling each configured service once. Nothing is written.\n');

  // --- Supabase ------------------------------------------------------------
  // Two separate checks, because they failed independently in practice: auth
  // worked while the database write was refused by row-level security.
  await check(
    'Supabase auth',
    config.supabase.enabled,
    'SUPABASE_URL + SUPABASE_ANON_KEY',
    async () => {
      const { url, anonKey } = config.supabase.require();
      const response = await withTimeout(
        fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } }),
        15_000,
        'supabase auth',
      );
      if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
      const settings = (await response.json()) as { external?: Record<string, unknown> };
      const providers = Object.keys(settings.external ?? {}).length;
      return `reachable, ${providers} sign-in providers configured`;
    },
  );

  await check(
    'Supabase schema',
    config.supabase.enabled,
    'SUPABASE_URL + SUPABASE_ANON_KEY',
    async () => {
      // Every table the app needs, asked for by name. A missing migration shows
      // up here as the exact table that is absent, rather than as a 500 on
      // whichever screen happens to touch it first.
      const tables = [
        'users',
        'exercises',
        'routines',
        'workout_logs',
        'custom_foods',
        'food_log',
        'food_cache',
        'body_measurements',
        'body_comp_evaluations',
        'push_subscriptions',
        'subscriptions',
      ];
      const { url, anonKey } = config.supabase.require();

      const missing: string[] = [];
      for (const table of tables) {
        const response = await withTimeout(
          fetch(`${url}/rest/v1/${table}?select=*&limit=0`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
          }),
          15_000,
          `supabase ${table}`,
        );
        // 200 means it exists and RLS returned nothing, which is correct for an
        // anonymous caller. 404/PGRST205 means the table is not there at all.
        if (response.status === 404) missing.push(table);
        else if (!response.ok && response.status !== 401 && response.status !== 403) {
          const body = await response.text();
          if (body.includes('PGRST205')) missing.push(table);
        }
      }

      if (missing.length > 0) {
        throw new Error(
          `${missing.length} table(s) missing: ${missing.join(', ')}. ` +
            'Apply backend/supabase/migrations/0001_init.sql in the SQL editor.',
        );
      }
      return `all ${tables.length} tables present`;
    },
  );

  // --- Gemini --------------------------------------------------------------
  // Runs the real provider, not a hand-rolled request, so the model name and
  // response parsing this app actually uses are what gets tested.
  await check(
    `Gemini vision (${config.ai.geminiModel})`,
    Boolean(config.ai.geminiApiKey),
    'GEMINI_API_KEY',
    async () => {
      const provider = createGeminiProvider(() => 'check');
      const estimate = await withTimeout(
        provider.estimateFromPhoto(tinyPng(), 'image/png'),
        45_000,
        'gemini vision',
      );
      return `answered and parsed — "${estimate.item.name}"`;
    },
  );

  await check(
    `Gemini text (${config.ai.geminiModel})`,
    Boolean(config.ai.geminiApiKey),
    'GEMINI_API_KEY',
    async () => {
      const provider = createGeminiProvider(() => 'check');
      const summary = await withTimeout(provider.phraseTrend(SAMPLE_TREND), 45_000, 'gemini text');
      return `${summary.length} characters returned`;
    },
  );

  // --- Groq ----------------------------------------------------------------
  await check(
    `Groq text (${config.ai.groqModel})`,
    Boolean(config.ai.groqApiKey),
    'GROQ_API_KEY',
    async () => {
      const provider = createGroqProvider();
      const summary = await withTimeout(provider.phraseTrend(SAMPLE_TREND), 45_000, 'groq');
      return `${summary.length} characters returned`;
    },
  );

  // --- Food databases ------------------------------------------------------
  // Both clients were written against saved sample responses and never ran
  // against the live APIs, which is the same situation that produced the
  // Gemini failure. A zero-result PASS still proves reachability and parsing.
  await check(
    'USDA food search',
    config.foodDatabase.usda.enabled,
    'USDA_FDC_API_KEY',
    async () => {
      const client = createUsdaClient();
      const items = await withTimeout(client.search('chicken breast'), 20_000, 'usda');
      const first = items[0];
      return items.length === 0
        ? 'reachable, but returned 0 results for "chicken breast" — check the parser'
        : `${items.length} results, first: ${first?.name} (${first?.calories} kcal)`;
    },
  );

  await check('Open Food Facts search', true, 'needs no key', async () => {
    const client = createOpenFoodFactsClient();
    const items = await withTimeout(client.search('nutella'), 20_000, 'open food facts');
    const first = items[0];
    return items.length === 0
      ? 'reachable, but returned 0 results for "nutella" — check the parser'
      : `${items.length} results, first: ${first?.name}`;
  });

  // --- Notifications -------------------------------------------------------
  await check(
    'OneSignal',
    config.notifications.enabled,
    'ONESIGNAL_APP_ID + ONESIGNAL_API_KEY',
    async () => {
      // Reads the app rather than sending anything: a check that pushed a real
      // notification to real devices would be a rude thing to run twice.
      const response = await withTimeout(
        fetch(`https://api.onesignal.com/apps/${config.notifications.appId}`, {
          headers: { Authorization: `Basic ${config.notifications.apiKey}` },
        }),
        15_000,
        'onesignal',
      );
      if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
      const app = (await response.json()) as { name?: string; players?: number };
      return `app "${app.name ?? 'unnamed'}", ${app.players ?? 0} devices registered`;
    },
  );

  // --- Exercise seed source ------------------------------------------------
  await check('Free Exercise DB', true, 'needs no key', async () => {
    const response = await withTimeout(
      fetch('https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'),
      30_000,
      'exercise db',
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const exercises = (await response.json()) as unknown[];
    return `${exercises.length} exercises available to seed`;
  });

  // --- Sentry --------------------------------------------------------------
  // Only the DSN's shape is checked. Confirming ingestion means sending a fake
  // error to the project, which pollutes the very thing you watch for real
  // problems — not worth it for a health check.
  results.push(
    config.sentry.enabled
      ? { name: 'Sentry', outcome: 'PASS', detail: 'DSN configured (ingestion not tested)' }
      : { name: 'Sentry', outcome: 'SKIP', detail: 'not configured (SENTRY_DSN)' },
  );

  // --- Report --------------------------------------------------------------
  const width = Math.max(...results.map((r) => r.name.length));
  const mark: Record<Outcome, string> = { PASS: '✓', FAIL: '✗', SKIP: '–' };

  console.log('');
  for (const result of results) {
    const timing = result.ms === undefined ? '' : ` (${result.ms}ms)`;
    console.log(`${mark[result.outcome]} ${result.name.padEnd(width)}  ${result.detail}${timing}`);
  }

  const failed = results.filter((r) => r.outcome === 'FAIL');
  const passed = results.filter((r) => r.outcome === 'PASS');
  const skipped = results.filter((r) => r.outcome === 'SKIP');

  console.log(
    `\n${passed.length} working, ${failed.length} failing, ${skipped.length} not configured.`,
  );

  if (failed.length > 0) {
    console.log('\nFailing services and what they cost you:');
    for (const result of failed) console.log(`  ${result.name}: ${result.detail}`);
    console.log(
      '\nNone of these stop the app. Each one degrades exactly one feature —\n' +
        'that is the design. But a failure here is real and will be visible to users.',
    );
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  console.error('\nThe check itself failed to run:', messageOf(error));
  process.exit(1);
});
