# Deviations from the build specification

The specification asked for any ambiguity or judgment call to be stated rather than
guessed at silently. This is that list.

Every entry is a correction to a genuine gap, contradiction or security problem —
not a re-litigation of a settled decision. The infrastructure choices the spec
declared closed (Render, Cloudflare Pages, no job queue, Sentry, GitHub Actions,
OneSignal, no real payments) were built as specified.

---

## Corrections the spec's own requirements forced

### Onboarding storage — the spec contradicted itself

§1 says onboarding answers live in **client-side state only** until signup
succeeds. It _also_ says that if the app is closed mid-onboarding after account
creation but before the final step, it must **resume at whichever step was not yet
submitted**.

Those cannot both hold if "client-side" means in-memory React state, which is gone
the moment the app closes — the exact case the resume requirement describes.

**Resolution:** "client-side" is read as _not on the server_, not _not on disk_. The
draft mirrors to `localStorage` on every change. `sessionStorage` would die on close;
IndexedDB's async read would make the router flash the wrong screen on boot. The
draft is cleared on completion and on logout, because it holds health data.

Spec rule 11 still holds: onboarding has no data model of its own. Progress is
**derived** server-side from the two domains it seeds — `users.goals` being
populated, and any `body_measurements` row existing.

Also: dietary preferences (step 4) have **no endpoint** in §7, so they ride inside
the `goals` jsonb. That is why there are exactly two post-signup writes, and
therefore exactly two resume states.

`statsClientId` is minted when the stats are **captured**, not when they are
submitted. That is what makes an interrupted submit replay-safe.

### Row-level security vs the service-role key — mutually exclusive as written

§8 mandates RLS on every user-owned table with `auth.uid() = user_id`. §10 gives the
backend `SUPABASE_SERVICE_ROLE_KEY`. **The service-role key bypasses RLS entirely**,
so as specified every policy would be decorative for API traffic — the one thing RLS
is there to prevent.

**Resolution:** `auth.middleware.ts` builds a **per-request** Supabase client from
the **anon** key with the caller's JWT forwarded, so `auth.uid()` resolves and the
policies actually apply. The service-role key is confined to
`config/supabaseAdmin.ts`, used only where there is genuinely no user JWT (the seed
script and shared `food_cache` writes), and that boundary is enforced by an eslint
`no-restricted-imports` rule rather than a comment.

Repositories **still** filter on `user_id` regardless. RLS is the layer a
credential-free test suite cannot exercise, so it must never be the only defence.

Structural consequence: because the database handle is per request, repositories are
built per request too — hence `AppDeps.repositories` is a factory, not a set of
singletons.

---

## Security problems in the specified API

### `PUT /users/me` taking `Partial<AuthUser>` is mass assignment

As specified, a client could `PUT { onboardingComplete: true }` and skip onboarding
entirely, or change its own `id` or `email` and desync from the auth record.

**Resolution:** a `UserUpdateInput` type and a `.strict()` zod allowlist covering
only client-owned fields. `id`, `email` and everything under `onboarding` are
server-owned, and an attempt to set them is a 400 rather than a silent no-op.
Asserted by a test.

### `client_id text unique` is a cross-tenant bug

The spec makes the offline idempotency key **globally** unique. That means:

- one user's key permanently blocks another user's write, and an attacker can
  pre-seed keys;
- a conflict response becomes an existence oracle for other users' rows;
- a lookup by `client_id` alone can return another user's row;
- the constraint is enforced below RLS, so it leaks across exactly the tenant
  boundary RLS exists to enforce.

**Resolution:** `unique (user_id, client_id)` on all four tables. Asserted both in
`verify-migration.sh` and in `offline-sync.test.ts` — two different users may reuse
the same key.

### Login must not distinguish a bad password from an unknown email

Not in the spec, but doing so turns the endpoint into an account-existence oracle.
Both return an identical status and message. Asserted by a test.

### Unbounded multipart upload

`POST /nutrition/scan-photo` had no size or type limit specified. Unbounded
multipart on a free instance is a trivial denial of service. Now capped at 8 MB with
an `image/*` allowlist, in memory only.

---

## Schema gaps that would have bitten later

| Spec as written                                                                          | Problem                                                                                                         | Resolution                                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `food_log` with no `id`                                                                  | No delete or edit path is possible                                                                              | Added `id`                                                                                                                                                       |
| `food_log` with no `client_id`                                                           | A user could create a custom food offline but not log eating it — the app's highest-frequency write             | Added `client_id`, joined the outbox                                                                                                                             |
| `food_log` with macros but no `servingMultiplier` column, while the endpoint accepts one | Nowhere to store it                                                                                             | Stores `base_*` macros **plus** the multiplier, with resolved totals as GENERATED STORED columns so SQL can `SUM()` and history freezes against upstream changes |
| `food_log` with no food name                                                             | Deleting a custom food makes past days unreadable                                                               | Added a required `food_name` snapshot                                                                                                                            |
| `food_cache` with one `query` column                                                     | A search by term and a lookup of one item collide                                                               | Added `kind` (`search`/`item`/`estimate`) and `unique(kind, source, query)`                                                                                      |
| `food_cache` world-readable                                                              | One user's AI estimate readable by another who guesses its id                                                   | Added nullable `user_id`; policy is `user_id is null or auth.uid() = user_id`                                                                                    |
| AI evaluation status with no column                                                      | §2 requires a `status` field; §8 has nowhere to put it                                                          | New `body_comp_evaluations` table — `body_measurements` is client-writable and last-write-wins, so an offline flush would clobber server-owned state             |
| `{ status: 'pending' \| 'ready' }`                                                       | Cannot express a call that never returned — exactly how a row sits pending forever                              | Widened to `none \| pending \| ready \| failed`, and `trend` is always returned so the UI degrades to numbers without prose                                      |
| `workout_logs` with only `routine_id` + `completed_at`                                   | History could only ever render a list of dates                                                                  | Added `performed` jsonb (sets, reps, weight) and a `routine_name` snapshot, with `routine_id ON DELETE SET NULL` so editing a routine cannot rewrite history     |
| No FK to `auth.users`, no cascades                                                       | Deleting an auth user orphans all health data, contradicting the deletion right the privacy policy must promise | `users.id references auth.users(id) on delete cascade`, and every `user_id` cascades. Asserted by a test                                                         |
| `/notifications/subscribe` with no storage                                               | Nowhere to keep the player id the notification needs                                                            | New `push_subscriptions` table — a table, not a column, so multi-device works                                                                                    |
| Settings tab with nowhere to persist                                                     | `users` had only id/email/onboarding/goals                                                                      | Added `users.units` and `users.preferences` jsonb                                                                                                                |
| `subscriptions` with no unique constraint                                                | Duplicate rows accumulate on a repeated `ensureFree`                                                            | Added `unique(user_id)`                                                                                                                                          |

`body_measurements` is deliberately **not** unique per day: an upsert would conflict
with the idempotency contract. Several entries per day are allowed, and the trend
engine resolves the ambiguity by taking the latest recorded entry per day, which is
unit-tested.

---

## Missing pieces added

- **`POST /auth/refresh`** and a single retry-on-401 in the client. The frontend
  holds the session itself, so supabase-js's auto-refresh never runs — without this,
  every session silently dies after about an hour.
- **`server.ts`**, separate from `app.ts`. §4 has no distinct entrypoint; without
  one, a test importing `app.ts` binds a port.
- **`repositories/supabase/admin-writes.ts`**, the single narrow module allowed to
  use the service-role key. The eslint rule caught the first version putting those
  writes among thirty RLS-scoped queries — which is precisely the boundary the rule
  exists to keep visible.
- **`stub.provider.ts`**, a third AI provider alongside Gemini and Groq, selected
  automatically when the configured provider has no key. This is what lets the whole
  suite run credential-free.
- **Wire types §4 omitted:** `ApiError`, `Goals`, `DietaryPreferences`,
  `OnboardingProgress`, `TrendResult`, `TrendRecommendation`, `BodyCompEvaluation`,
  `PhotoScanResult`, `NutritionSearchResult`, `PushSubscription`, `OfflineQueueItem`.
- **`trend-rules.ts` insufficient-data rule.** The spec defined no minimum evidence.
  Below ~14 days, 2 weigh-ins and 7 logged food days, weight noise swamps the signal
  and the arithmetic produces confident nonsense. It now refuses and says what is
  missing.
- **A global daily AI vision cap.** The upstream quota is account-wide, so per-user
  limits alone let one user drain the whole deployment's allowance.
- **`verify-migration.sh`.** Not requested. RLS was otherwise untestable, so the
  migration is applied to a real Postgres in CI and its policies asserted.

---

## Product decisions confirmed with the repository owner

- **Offline food logging: in scope.** `food_log` gains an idempotency key and joins
  the outbox. It is the app's most frequent write and the most likely to happen with
  bad signal.
- **Meal photos: never persisted.** Streamed to the provider in memory and
  discarded; only the estimate is stored. Cheapest PDPL posture, and no bucket, RLS
  policy or retention rule to get wrong. The privacy policy states this plainly.
- **Workout logs: record sets and reps**, not just a date.
- **Styling: Tailwind with `tokens.ts` as its input.** Tailwind 4 configures in CSS,
  so a codegen step emits an `@theme` block from the tokens file, with CI asserting
  it is not stale. That keeps the spec's single-source-of-truth rule intact while
  still giving utility classes.

---

## Behaviour changed by testing

Two bugs found by tests rather than review, both in the no-queue evaluation design:

1. **`GET /body-composition/evaluation` blocked on the AI retry.** A hung provider
   stalled every poll for the full 20-second timeout. The reaper now starts the run
   in the background and returns current state immediately.
2. **`claimForRun`'s staleness gate blocked the first attempt.** A freshly inserted
   row is not stale, so the initial run could never claim it. The gate now applies
   to retries only.

And three on the frontend, all in session handling: a non-reactive session store
that left the user stranded after a failed refresh; a redirect race that sent an
expired session to the welcome screen; and the underlying cause — the API client
clears the session itself, so a component cannot distinguish expiry from a
deliberate sign-out. The expiry signal now lives in the API layer that detects it.
