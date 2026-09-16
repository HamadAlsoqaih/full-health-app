/**
 * Startup smoke tests — boots the REAL server as a child process.
 *
 * Why this file exists: every other test builds the app with
 * `createApp(fakeDeps)`, which never runs server.ts, never reads a .env file and
 * never assembles the middleware from real configuration. Three bugs shipped
 * straight through that gap:
 *
 *   1. A blank optional key (`GEMINI_API_KEY=`, which is how a copied
 *      .env.example leaves it) failed validation and killed the process at
 *      import time.
 *   2. Nothing loaded backend/.env, so local configuration was inert and the
 *      documented setup could not work.
 *   3. The rate limiter keyed on `req.ip` raw, logging an IPv6-bypass warning
 *      on every boot.
 *
 * None were visible to a test that imports modules directly; all three are
 * visible here, because this runs the app the way a person does.
 *
 * Structure: each case owns one server for its own lifetime, rather than a
 * shared long-lived process. A shared one made failures depend on test ordering
 * and timing instead of on the thing being tested.
 *
 * Supabase values are dummies: /api/health must not touch the database, so this
 * needs no credentials and runs in CI.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serverEntry = resolve(backendRoot, 'src/server.ts');
/**
 * tsx's CLI, invoked through `process.execPath` rather than `npx tsx`: npx is a
 * wrapper that becomes the child, so its exit is indistinguishable from the
 * server's. It also removes the need for a shell on Windows.
 */
const tsxCli = resolve(backendRoot, '../node_modules/tsx/dist/cli.mjs');

interface BootResult {
  /** Everything the process wrote to stdout and stderr. */
  output: string;
  /** Whatever the callback returned, or undefined if the server never came up. */
  probed: unknown;
  ready: boolean;
}

/**
 * Starts the server, waits for it to report itself listening, runs `probe`
 * against it, and always tears it down.
 */
async function boot(
  options: { port: number; env?: Record<string, string | undefined>; cwd?: string },
  probe?: (baseUrl: string) => Promise<unknown>,
): Promise<BootResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Explicitly not 'test': this must exercise the real startup path, including
    // the dotenv load that the test path deliberately skips.
    NODE_ENV: 'development',
    ...options.env,
  };
  // An undefined entry means "unset this", which matters for the dotenv case:
  // dotenv never overrides an existing variable, and '' still counts as set.
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
  }

  const child = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: options.cwd ?? backendRoot,
    env,
    // A server never reads stdin; an idle open pipe is a source of odd behaviour.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (c: Buffer) => (output += c.toString()));
  child.stderr.on('data', (c: Buffer) => (output += c.toString()));

  try {
    const deadline = Date.now() + 40_000;
    let ready = false;
    while (Date.now() < deadline) {
      // Any terminal line ends the wait — a refusal to start is a valid result
      // to assert on, not a timeout.
      if (/API listening/.test(output)) {
        ready = true;
        break;
      }
      if (/Invalid environment configuration|required to run the API/.test(output)) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    const probed = ready && probe ? await probe(`http://127.0.0.1:${options.port}`) : undefined;
    return { output, probed, ready };
  } finally {
    child.kill('SIGKILL');
  }
}

const DUMMY_SUPABASE = {
  SUPABASE_URL: 'https://smoke-test.supabase.co',
  SUPABASE_ANON_KEY: 'smoke-test-anon-key',
};

/** Every optional credential blank, exactly as a copied .env.example leaves them. */
const BLANK_OPTIONALS = {
  GEMINI_API_KEY: '',
  GROQ_API_KEY: '',
  USDA_FDC_API_KEY: '',
  SENTRY_DSN: '',
  ONESIGNAL_APP_ID: '',
  ONESIGNAL_API_KEY: '',
};

describe('the server starts with blank optional credentials', () => {
  it('comes up, serves health, and gates a protected route', async () => {
    const port = 8781;

    const { output, ready, probed } = await boot(
      { port, env: { PORT: String(port), ...DUMMY_SUPABASE, ...BLANK_OPTIONALS } },
      async (baseUrl) => ({
        health: await (await fetch(`${baseUrl}/api/health`)).json(),
        healthStatus: (await fetch(`${baseUrl}/api/health`)).status,
        protected: await (await fetch(`${baseUrl}/api/overview`)).json(),
        protectedStatus: (await fetch(`${baseUrl}/api/overview`)).status,
        unknownStatus: (await fetch(`${baseUrl}/api/nope`)).status,
      }),
    );

    // Bug 1: blank optional keys used to throw during config parsing.
    expect(output).not.toMatch(/Invalid environment configuration/);
    expect(ready, `server never reported listening:\n${output}`).toBe(true);

    const result = probed as Record<string, unknown>;
    expect(result.healthStatus).toBe(200);
    expect(result.health).toEqual({ status: 'ok', env: 'development' });

    // The real middleware chain, not a fake.
    expect(result.protectedStatus).toBe(401);
    expect(result.protected).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(result.unknownStatus).toBe(404);

    // Falls back to the stub provider rather than failing over a blank key.
    expect(output).toMatch(/"aiProvider":"stub"/);

    // Bug 3: this warning appeared on every boot.
    expect(output).not.toMatch(/ERR_ERL_KEY_GEN_IPV6/);
    expect(output).not.toMatch(/ValidationError/);
    expect(output).not.toMatch(/unhandledRejection/i);
  }, 60_000);
});

describe('configuration is read from a .env file', () => {
  it('starts from the file alone, with nothing passed in the environment', async () => {
    // Bug 2. The file goes in a TEMPORARY directory used as the working
    // directory — never backend/.env, which would clobber a developer's real
    // configuration. The working directory is the first candidate the loader
    // checks, so this is the same path `npm run dev` takes.
    const dir = mkdtempSync(join(tmpdir(), 'fha-env-'));
    const port = 8782;

    try {
      writeFileSync(
        join(dir, '.env'),
        [
          'SUPABASE_URL=https://from-dotenv.supabase.co',
          'SUPABASE_ANON_KEY=key-from-dotenv',
          `PORT=${port}`,
          'GEMINI_API_KEY=',
          'USDA_FDC_API_KEY=',
        ].join('\n'),
      );

      const { output, ready } = await boot({
        port,
        cwd: dir,
        // Unset rather than blanked: dotenv does not override a variable that is
        // already present, and '' counts as present.
        env: { PORT: undefined, SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined },
      });

      expect(output).not.toMatch(/required to run the API/);
      expect(ready, `server did not start from .env:\n${output}`).toBe(true);
      expect(output).toContain(String(port));
      expect(output).toMatch(/"aiProvider":"stub"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('the server refuses to start without Supabase', () => {
  it('exits with a message naming what is missing', async () => {
    const { output, ready } = await boot({
      port: 8783,
      env: { PORT: '8783', SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined },
    });

    // A clear refusal beats a confusing failure on the first request.
    expect(ready).toBe(false);
    expect(output).toMatch(/SUPABASE_URL and SUPABASE_ANON_KEY are required/);
    expect(output).toMatch(/docs\/SETUP\.md/);
  }, 60_000);
});
