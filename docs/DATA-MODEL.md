# Data model

The authoritative definition is `backend/supabase/migrations/`, applied in filename
order and commented at every non-obvious decision: `0001_init.sql` is the whole
schema, `0002_food_cache_update_policy.sql` adds the RLS policy that lets a user
replace their own AI photo estimate. This is the shape and the reasoning.

---

## Two rules that hold everywhere

**1. Metric only.** `weight_kg`, `tape_cm`. Unit preference is a display concern
converted at the UI edge and nowhere else. A kilogram column that sometimes holds
pounds is unrecoverable — you cannot tell afterwards which rows are which.

**2. Every user-owned table cascades from `auth.users` and has RLS.** All four verbs
restricted to `auth.uid() = user_id`, written at table creation rather than bolted on.
The cascade is what makes the privacy policy's deletion right enforceable in the
database instead of dependent on application code remembering.

---

## Tables

### `users`

A public mirror of `auth.users` carrying app-level state: `onboarding_complete`,
`goals` jsonb, `units`, `preferences` jsonb.

`id` references `auth.users(id) on delete cascade`. Created or refreshed by
`ensureUserRow`, called from register, login **and** getMe — register alone is not
enough, because OAuth never touches `/auth/register`.

`goals` holds the onboarding answers **including dietary preferences**, because step 4
of onboarding has no endpoint of its own. `preferences` holds the Settings toggles.

### `exercises`

Global reference data, seeded from Free Exercise DB. Not user-owned, so RLS is enabled
with a read-only policy for authenticated users — readable but not client-writable.
`external_id` is the upstream slug, so re-seeding is idempotent.

`media_url` is a URL string. Exercise media is never stored as binary in the database
or committed to the repository.

### `routines`

`exercises` is a jsonb array of `RoutineExercise`. Each entry carries a denormalised
`exerciseName`, so a routine still reads correctly if the library is reseeded.

Because it is jsonb there is no referential integrity, which is why
`routines.service.ts` validates every `exerciseId` against the library — otherwise a
routine could reference an exercise that never existed and fail mid-workout.

### The four offline-syncable tables

`workout_logs`, `custom_foods`, `food_log`, `body_measurements`.

Each carries `client_id text not null` with **`unique (user_id, client_id)`** and a
length check of 8–128 characters.

The composite key is not a detail. A global `unique(client_id)` — as originally
specified — means one user's key permanently blocks another's write, a conflict
response becomes an existence oracle, and the constraint leaks across the very tenant
boundary RLS exists to enforce. Unique constraints are evaluated below RLS.

The key space is also **per resource**: the same `clientId` on a workout log and a
custom food is legal. There is no shared idempotency-keys table, which would need its
own retention and garbage collection for no benefit.

#### `workout_logs`

`performed` jsonb records what was actually done — sets, reps, weight. Without it,
history could only ever render a list of dates.

`routine_name` is a snapshot and `routine_id` is `ON DELETE SET NULL`, so editing or
deleting a routine cannot rewrite history. `synced_at` is distinct from
`completed_at`: the gap between them is the offline queue.

#### `food_log`

The most-corrected table.

```
serving_multiplier  numeric      the user's "1.5 servings"
base_calories, base_protein_g, base_carbs_g, base_fat_g   per-serving values
calories, protein_g, carbs_g, fat_g   GENERATED ALWAYS AS (base × multiplier) STORED
food_name           text not null     snapshot
food_item_id        text              namespaced: usda: / off: / custom: / estimate: / manual:
```

Both the base values and the multiplier are kept so the entry stays editable as "1.5
servings", and the resolved totals are generated columns so `/overview` and daily
sums aggregate directly in SQL and history is frozen against later upstream changes.

`food_name` is required because without it, deleting a custom food makes past days
unreadable.

The generated columns must not be written; Postgres rejects an explicit value.

#### `body_measurements`

Deliberately **not** unique per day. An upsert-per-day would conflict with the
idempotency contract, so several entries per day are allowed and the trend engine
resolves the ambiguity by taking the **latest recorded** entry per day — latest
`created_at`, not highest or lowest weight, so the user's most recent correction wins.
Unit-tested.

Value checks mirror plausibility, not politeness: weight `> 0 and < 700`, body fat
`0..75`.

### `food_cache`

Sits in front of USDA and Open Food Facts, and holds AI photo estimates.

`kind` is `search | item | estimate`, with `unique (kind, source, query)`. Without
`kind`, a search by term and a lookup of a single item collide in one table.

`user_id` is **nullable**: null for shared upstream data, set for an estimate. So one
user's estimate is not readable by another who guesses its id. The policy is
`user_id is null or auth.uid() = user_id`.

A row older than 30 days counts as a miss, otherwise the cache would pin whatever
upstream said the first time, forever.

Shared writes go through the service-role client (there is no owning user);
per-user estimate writes go through the request-scoped client and are subject to RLS
like anything else.

### `body_comp_evaluations`

Server-owned async state for the AI phrasing of a trend.

A **separate table**, not columns on `body_measurements`, because that row is
client-writable and last-write-wins: an offline queue flush would clobber
`status` and `summary`. It is also 0..1 per measurement, which nullable columns on
every measurement model badly — "no evaluation yet" becomes indistinguishable from
"pending".

```
status       pending | ready | failed
trend        jsonb    the deterministic result, written BEFORE any AI call
summary      text     AI phrasing only; null until ready
attempts     int      retry bookkeeping for the reaper
started_at, completed_at
unique (measurement_id)
```

`trend` being written synchronously is what makes the numbers durable even if the AI
never answers, and what stops the client's first poll racing the insert. A partial
index on `(status, started_at) where status = 'pending'` supports the reaper.

### `push_subscriptions`

A table, not a column on `users`, so one account can register several devices — the
normal case for a PWA. `unique (user_id, player_id)`.

### `subscriptions`

Billing placeholder. Always `plan = 'free'`, `is_premium = false`.
`unique (user_id)` stops duplicate rows accumulating from a repeated `ensureFree`.
Not created during registration: a two-write signup that can half-fail buys nothing
while there is no real plan.

---

## Timestamps and last-write-wins

`created_at` and `updated_at` exist on all four offline-syncable tables, maintained by
a `touch_updated_at` trigger. The specification calls for last-write-wins by server
timestamp, and these support it.

**But LWW is currently vacuous**, and that is worth stating rather than leaving as an
apparent omission: all four tables are append-only with no update path, and the
idempotency key already prevents duplicates. So no merge logic was built. If an edit
path is added later, these columns are what it resolves against.

---

## Onboarding has no data model

By design. Its answers seed two other domains, and its progress is **derived**:

- `goalsSubmitted` — `users.goals` is populated
- `startingStatsSubmitted` — a `body_measurements` row exists
- `complete` — `users.onboarding_complete`, flipped lazily in `getMe` once both hold

That derivation is what makes resume-after-close possible without an onboarding
table, and it means a client cannot lie about its own progress.
