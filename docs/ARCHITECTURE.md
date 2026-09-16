# Architecture

## Shape

An npm workspaces monorepo with three packages:

```
packages/shared-types/   Every type that crosses the network. Declared once.
backend/                 Express + TypeScript API.
frontend/                React + Vite PWA.
```

`@app/shared-types` is consumed **as TypeScript source** via a tsconfig path, so a
cold clone typechecks with no build-order step. `tsc` does not rewrite path aliases
in its output, so the backend's runtime artifact is bundled with esbuild, which
resolves the alias to the real file.

---

## The rule that shaped the backend

**Every test must pass with zero credentials and zero network access.**

That is not a testing preference; it is forced by the environment. CI has no
secrets, and the USDA and Open Food Facts hosts are unreachable from the build
environment. If the architecture had required real services to test anything, there
would be no test suite at all.

So every external system is reached through an interface in `src/ports.ts`, and the
whole set is handed to `createApp()` in one object:

```ts
interface AppDeps {
  auth: AuthPort;
  repositories: (ctx: RepositoryContext) => Repositories; // a factory, see below
  ai: AiProvider;
  foodDatabases: FoodDatabasePort[];
  notifications: NotificationsPort;
  clock: () => Date; // injected for determinism
  uuid: () => string;
}
```

An integration test builds that object from hand-written in-memory fakes and drives
the **real** Express app, middleware chain, controllers and services through
supertest.

**Why fakes and not `vi.mock('@supabase/supabase-js')`:** mocking the client means
re-implementing its fluent builder (`.from().select().eq().single()`) in every test
file, and such a mock cannot hold state across requests. The offline-sync test
fundamentally needs the second POST to see the row the first POST created. The fakes
also reproduce two Postgres behaviours the tests depend on: a duplicate
`(userId, clientId)` insert throws code `23505`, and `claimForRun` is a conditional
update rather than read-then-write.

### Why `repositories` is a factory

Because of row-level security. `auth.middleware.ts` builds a **per-request** Supabase
client from the anon key with the caller's JWT forwarded, so `auth.uid()` resolves
inside Postgres and the policies actually apply. A per-request database handle means
per-request repositories.

The alternative — the service-role key, which the spec supplies — bypasses RLS
entirely and would make every policy decorative. See `docs/DEVIATIONS.md`.

Repositories **also** filter on `user_id` regardless of RLS, because RLS is the one
layer the credential-free suite cannot exercise and must never be the only defence.

---

## Request path

```
express.json
  → per-router requireAuth        validates the bearer token, attaches
                                   req.user and per-request repositories
  → rate limiter                  per user when authenticated, per IP otherwise
  → validate(schema)              zod, .strict(); replaces the request part
                                   with the parsed value
  → idempotency(finder)           offline-syncable writes only: a replay returns
                                   200 with the stored row
  → controller                    thin; unwraps the request, calls a service
  → service                       all the logic
  → repository                    the only thing that touches the database
  → errorHandler                  everything leaves as { error: { code, message } }
```

Auth is mounted **per router**, not globally with a path exception. The spec's
"everything except `/api/auth/*`" is nearly right, but `POST /auth/logout` needs
`req.user` — a blanket prefix exemption would leave the one authenticated auth route
open. `auth.test.ts` enumerates all 22 protected routes so a route added later
without `requireAuth` fails the suite.

---

## Three pieces of non-obvious control flow

### 1. Offline writes and idempotency

Four writes can be queued on the device: workout logs, custom foods, food log
entries and body measurements. Food _search_ cannot be — it needs a live upstream,
so there is nothing useful to cache.

The client mints a UUID per queued write, which doubles as the server's idempotency
key. On replay the server returns **200 with the stored row**:

- not 201, because nothing was created;
- not 409, because the client did nothing wrong — and a conflict would make the
  outbox treat the item as failed and retry it forever.

The middleware is only a fast path. Read-then-write is not atomic, so two concurrent
flushes can both miss it; `insertIdempotent` catches the resulting unique violation,
re-reads, and returns the same 200. **The constraint is the correctness guarantee**,
and the key is `unique (user_id, client_id)` so two users cannot collide.

The outbox flushes **in order** and stops at the first transient failure, because a
food-log entry can reference a custom food created moments earlier in the same
offline session. A 4xx other than 408/429 is permanent and the item is dropped.

### 2. The AI evaluation, with no queue

One job type does not justify BullMQ and a Redis dependency, so the evaluation is a
plain async function started without being awaited. That has three consequences,
each handled explicitly:

- **An escaping rejection would kill the process** via `unhandledRejection`. So
  `runEvaluation` never throws; it always writes a terminal state.
- **The process can die mid-call** — free-tier hosting sleeps when idle. A reaper on
  the read path re-fires a stale pending row, bounded by an attempt ceiling, so a row
  can never sit pending forever.
- **Concurrent polls could double-fire.** Every transition is a conditional update
  that reports whether it won, so the AI call and the notification each happen once.

The ordering in `recordMeasurement` matters: insert the measurement, compute the
trend, insert the evaluation row as `pending` **with that trend**, respond, _then_
start the AI call. The deterministic numbers are durable even if the AI never
answers, and the first client poll cannot race the insert.

The reaper deliberately does **not** await the retry: the client polls this endpoint,
so a hung provider would otherwise stall every poll for the full timeout.

### 3. Trend arithmetic is deterministic, never AI

`trend-rules.ts` is pure. The AI layer only rephrases an already-final result, which
is why a user with AI switched off still gets the complete analysis — they just do
not get prose.

- The weekly rate is a **least-squares regression**, not `(last - first) / days`,
  which is dominated by whatever noise sits on those two days. A test asserts the
  regression beats endpoint differencing on a spiked series.
- Intake is averaged over days that **have** food logged, not the whole window: a day
  the user never opened the app is missing data, not a zero-calorie day.
- Below ~14 days, 2 weigh-ins and 7 logged food days, it **refuses** and says what is
  missing, rather than producing confident nonsense.
- Suggested changes are clamped to ±500 kcal and rounded to 25, because presenting
  "137 kcal" implies precision this arithmetic does not have.

---

## Frontend

### One place decides routing

`AppRouter.tsx` implements the whole auth/onboarding decision tree. No feature screen
re-checks either. The decision has six inputs — session present, profile loaded,
goals submitted, stats submitted, onboarding complete, requested route — and
duplicating it anywhere guarantees the copies eventually disagree.

Resolution order, first match wins:

```
0. session present, profile loading      → splash
1. no session                            → onboarding (or login/signup if asked for,
                                            or login if a session just expired)
2. onboarding complete                   → the five tabs
3. goals not submitted                   → resume at goals
4. goals in, stats not submitted         → resume at stats
```

States 3 and 4 read the **server-derived** progress flags, not the local draft,
because the draft can be absent entirely — someone who signs up on their phone and
reopens on a laptop must still land on the right step.

### Onboarding resume

The draft mirrors to `localStorage`, and `statsClientId` is minted when the stats are
captured rather than submitted — so an interrupted submit retries with the same
idempotency key and cannot create a second measurement. `ResumeOnboarding`
auto-submits whatever is outstanding, so the usual resume is a brief spinner; where
no draft survived, it renders the relevant step's form.

### Data layer

TanStack Query, with defaults tuned for a phone: a minute of freshness to avoid a
refetch storm between tabs, refetch on focus because the app is backgrounded
constantly, no retry on 4xx, and **mutations never retried automatically** — writes
that can be queued go through the outbox, which owns retrying with an idempotency
key.

The Overview tab reads **one** endpoint and imports no other feature's api module.
Beyond the architectural rule, that is what makes the numbers on it mutually
consistent; five requests would assemble a snapshot from five different moments.

---

## Mobile standards

These are enforced in shared components rather than remembered per screen, because
each has a visible consequence on a real phone:

- **16px minimum control font size.** Below it, iOS Safari zooms the viewport on
  focus and the layout lurches sideways mid-entry.
- **`inputMode="decimal"` with `type="text"`**, not `type="number"` — which shows
  spinners nobody taps and rejects intermediate states like `88.` while typing.
- **44×44px minimum tap targets** (Apple HIG) / 48dp (Material).
- **`viewport-fit=cover` + `env(safe-area-inset-*)`** so the bottom nav clears the
  iOS home indicator, and toasts sit above the nav.
- **Five tabs, fixed to the bottom**, in the thumb zone. Active state signalled by
  colour _and_ weight _and_ an underline — never colour alone.
- **Skeletons, not spinners**, for list loads: they reserve the space the content
  will occupy so the layout does not jump under the user's thumb.
- **An error boundary**, because a white screen in an installed PWA has no address
  bar to escape from.
- **Code-split chart.** Recharts is the heaviest dependency and one of five tabs
  renders it. Splitting took initial load from 246 kB to 143 kB gzipped.

Design tokens live in `shared/theme/tokens.ts` — the only place a colour, type size,
radius or named length is written. A codegen step emits an `@theme` block for
Tailwind 4 plus dark-mode overrides, and CI asserts the generated file is not stale.

---

## Where things are

```
backend/src/
  config/            environment; supabaseAdmin.ts isolates the service-role key
  controllers/       thin HTTP adapters
  services/          all logic, grouped by domain
  repositories/      interfaces + supabase/ implementation + admin-writes.ts
  models/            backend row shapes, extending the wire types
  routes/            per-router auth mounting
  middlewares/       auth, validate, idempotency, rate-limit, error-handler
  validation/        one zod schema per endpoint
  scripts/           the exercise seed
  ports.ts           the dependency seam
  app.ts             createApp(deps)
  server.ts          listen, so tests need no port

frontend/src/
  features/<domain>/ components, hooks, api.ts per feature
  shared/
    components/      BottomNav, Field primitives, Skeleton, Empty/Error, Toast
    lib/             apiClient, offlineQueue, queryClient, units, config
    theme/           tokens.ts (source) + theme.generated.css (generated)
  routes/            AppRouter, TabLayout
```
