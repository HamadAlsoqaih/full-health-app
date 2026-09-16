# Testing

```bash
npm test                              # both workspaces — 246 tests
npm test --workspace backend          # 178 tests
npm test --workspace frontend         # 68 tests
./backend/supabase/verify-migration.sh  # 22 schema/RLS assertions (needs Postgres)
```

**Everything passes with no `.env`, no Supabase project, no API keys and no network
access.** That is not a nicety — CI has no secrets, and two of the upstream hosts are
unreachable from the build environment. An architecture that needed real services to
test anything would have had no tests at all.

---

## What is covered

| File                                                        | Tests | Covers                                             |
| ----------------------------------------------------------- | ----- | -------------------------------------------------- |
| `backend/tests/unit/trend-rules.test.ts`                    | 23    | The trend algorithm                                |
| `backend/tests/unit/config.test.ts`                         | 21    | Blank env vars, malformed values, URL shape        |
| `backend/tests/unit/food-database.test.ts`                  | 14    | USDA + Open Food Facts parsing                     |
| `backend/tests/unit/parse-estimate.test.ts`                 | 10    | AI response parsing                                |
| `backend/tests/unit/rate-limit-key.test.ts`                 | 9     | Per-user keying, IPv6 subnet collapsing            |
| `backend/tests/unit/logger.test.ts`                         | 5     | What request logging retains                       |
| `backend/tests/integration/auth.test.ts`                    | 38    | Auth, gating, mass assignment, onboarding progress |
| `backend/tests/integration/overview-and-evaluation.test.ts` | 21    | Aggregation, the caller's date, evaluation, reaper |
| `backend/tests/integration/nutrition.test.ts`               | 14    | Cache-first, never-auto-log, daily log             |
| `backend/tests/integration/offline-sync.test.ts`            | 12    | Idempotency across all four queued writes          |
| `backend/tests/integration/routines.test.ts`                | 8     | CRUD, cross-user isolation, history preservation   |
| `backend/tests/integration/startup.smoke.test.ts`           | 3     | A real process booting, from `.env` alone          |
| `frontend/tests/tabs-render.test.tsx`                       | 23    | All five tabs: full, empty and failing payloads    |
| `frontend/tests/onboarding-flow.test.tsx`                   | 17    | The full flow, draft persistence, resume           |
| `frontend/tests/offline-queue.test.ts`                      | 14    | Outbox ordering, drop and retry semantics          |
| `frontend/tests/workout-player.test.tsx`                    | 8     | Per-set logging, skipped sets, discard guard       |
| `frontend/tests/dates.test.ts`                              | 6     | Local calendar dates across timezones and DST      |
| `backend/supabase/verify-schema.sql`                        | 22    | Constraints, RLS policies, cascades                |

---

## The assertions that matter most

These are the ones worth understanding, because they encode properties that are not
visible from reading the code.

**Auth gating is enumerated, not sampled.** `auth.test.ts` lists all 22 authenticated
routes and asserts each 401s without a token. A route added later without
`requireAuth` fails the suite.

**Two users may reuse the same `clientId`.** Asserted in both `offline-sync.test.ts`
and `verify-schema.sql`. Under the specified global `unique(client_id)` this would
fail — and one user could permanently block another's writes by guessing keys.

**A replay returns a byte-identical body.** So the client needs no special case: it
drops the queue item whether it got 201 or 200.

**Concurrent flushes produce exactly one row and exactly one 201.** Four simultaneous
POSTs of the same item: all succeed, one created, one row.

**The outbox stops at the first transient failure.** A food-log entry can reference a
custom food created moments earlier offline, so order must hold. Asserted by
checking the third request is never attempted after the second fails.

**A rejected item is dropped, not retried forever.** A 400 in the middle of the queue
must not block everything behind it.

**The photo scan writes no `food_log` row**, and the image bytes appear nowhere in the
datastore — asserted by putting a unique marker in the uploaded buffer and searching
the whole store for it.

**A cache hit does not call upstream.** The fake food database records its calls;
after a repeat search the call count is still 1. Both quotas are shared across the
whole deployment, so an uncached repeat spends everyone's budget.

**An evaluation cannot sit pending forever.** With a provider that never answers,
repeated polls advance the attempt count and the row eventually settles as `failed`
— with the deterministic trend still intact.

**The notification fires exactly once** across repeated polls. A read-then-write
reaper would send it several times.

**Deleting an auth user leaves zero orphaned health rows**, and does not touch
another user's data. That is what makes the privacy policy's deletion right real
rather than aspirational.

**Regression beats endpoint differencing.** `trend-rules.test.ts` spikes the final
weigh-in by 1.5 kg and asserts the least-squares rate stays closer to the true value
than `(last - first) / days` does.

**The trend refuses rather than guessing.** A user with 30 weigh-ins and no food logs
gets `insufficient-data` naming exactly what is missing, not a fabricated
recommendation.

**Imperial entry is converted before it leaves the device.** 195 lb arrives at the
API as 88.45 kg. A kilogram column holding pounds is unrecoverable.

**Onboarding resume uses the same idempotency key** as the interrupted attempt, so
the retry cannot create a second measurement — and the user is never asked to retype
the weight.

**Resume works with no draft at all.** Simulating a different device: the server's
progress flags alone put the user on the right step.

---

## How the credential-free suite works

`backend/tests/helpers/app.ts` builds the real Express app with in-memory fakes:

```ts
const { app, store, seedUser, advance } = createTestHarness();
const { token } = seedUser('a@example.com');

await request(app).post('/api/workout-logs').set('Authorization', `Bearer ${token}`).send(payload);
```

The fake `AuthPort` issues `test-token:<userId>`, which is what makes every
authenticated request a one-liner. `advance(ms)` moves the injected clock, which is
how the staleness and reaper paths are tested without waiting.

The fakes deliberately reproduce two Postgres behaviours:

- a duplicate `(userId, clientId)` insert throws `{ code: '23505' }`, so the
  idempotency path is exercised rather than bypassed;
- `claimForRun` is a conditional update, so a double-poll cannot double-fire there
  either.

Fakes are **not** a mock of `@supabase/supabase-js`. Mocking the client would mean
re-implementing its fluent builder per test file, and a mock cannot hold state across
requests — which the offline-sync test fundamentally needs.

For the frontend, `frontend/tests/helpers/render.tsx` mounts the real `AppRouter`,
providers and screens against a stub fetch driven by a route table. Nothing above the
network boundary is mocked, so the tests exercise the actual routing logic.

---

## The schema harness

`verify-migration.sh` applies `0001_init.sql` to a throwaway Postgres and runs
assertions over it. `test-prelude.sql` stands in for the parts of a Supabase project
the migration depends on but does not create — the `auth` schema, `auth.users`,
`auth.uid()` and the `anon`/`authenticated` roles. RLS is exercised by impersonating a
user the way Supabase does, with `set local role authenticated` plus a JWT-derived uid.

The RLS assertions test the security **property** rather than fixed row counts:
"I see none of anyone else's rows" rather than "I see exactly 4 rows", so adding a
fixture cannot silently weaken them.

CI runs this against a `postgres:16` service container. It needs no Supabase project
and no secrets.

---

## What is not covered

Honest gaps:

- **No end-to-end browser test.** No Playwright run against a real browser; component
  tests use jsdom.
- **No live-service test.** Supabase auth, real Gemini output, real USDA and Open Food
  Facts responses, OneSignal delivery and Sentry ingestion have never been exercised.
  Parsing is covered by fixtures; transport is not.
- **RLS against Supabase's own `auth.uid()`** has not run. The local harness covers
  the policies, but not that exact implementation.
- **No load or concurrency testing** beyond the four-way idempotency race.
- **No visual regression testing.** Layout was verified by reading and by build
  output, not by screenshot comparison.
