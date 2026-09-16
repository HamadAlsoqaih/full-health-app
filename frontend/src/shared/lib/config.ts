/**
 * Frontend configuration.
 *
 * Vite inlines `VITE_*` at build time, so everything here ends up readable in the
 * shipped bundle. Only genuinely public values live here: the API base URL, the
 * Sentry browser DSN (which grants ingest and nothing else) and the OneSignal app
 * id. No AI provider key, no OneSignal REST key and no Supabase service-role key
 * ever reaches the client (spec rule 7).
 *
 * Every value falls back to something harmless so `npm run build` succeeds with no
 * .env at all, which is the state in CI. A missing value degrades one feature and
 * is surfaced at the point of use, rather than failing the build.
 */
const env = import.meta.env;

export const config = {
  /** Empty means same-origin, which is what a single-domain deployment wants. */
  apiBaseUrl: (env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  sentry: {
    dsn: (env.VITE_SENTRY_DSN as string | undefined) ?? '',
    get enabled(): boolean {
      return this.dsn.length > 0;
    },
  },
  oneSignal: {
    appId: (env.VITE_ONESIGNAL_APP_ID as string | undefined) ?? '',
    get enabled(): boolean {
      return this.appId.length > 0;
    },
  },
  isDev: env.DEV,
} as const;
