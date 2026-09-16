-- =============================================================================
-- 0001_init.sql — initial schema, constraints and row-level security.
--
-- Apply with the Supabase CLI (`supabase db push`) or by pasting into the SQL
-- editor of a fresh project. See docs/SETUP.md.
--
-- Two conventions hold throughout:
--
--   1. Measurements are stored in metric only (kg, cm). Unit preference is a
--      display concern converted at the UI edge. Mixing units in one column is
--      how a weight history silently becomes nonsense.
--
--   2. Every user-owned table carries `user_id` with ON DELETE CASCADE up to
--      auth.users, and an RLS policy restricting all four verbs to
--      auth.uid() = user_id. RLS is written here at table creation rather than
--      bolted on later.
--
-- RLS is only effective for API traffic because the backend forwards the user's
-- JWT with the anon key, instead of holding the service-role key for every
-- request. The service-role key bypasses RLS entirely and is confined to the few
-- operations that have no user JWT. See docs/DEVIATIONS.md ("RLS vs service role").
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- users
--
-- A public mirror of auth.users carrying app-level profile state. The FK to
-- auth.users with ON DELETE CASCADE is what makes the deletion right in the
-- privacy policy actually enforceable: removing the auth user removes every
-- health record below it, rather than orphaning it.
-- =============================================================================
create table public.users (
  id                  uuid primary key references auth.users (id) on delete cascade,
  -- Denormalised copy of the auth email. auth.users remains the source of truth;
  -- this is refreshed on register/login/getMe so it cannot drift silently.
  email               text not null,
  display_name        text,
  onboarding_complete boolean not null default false,
  -- Goals, and dietary preferences nested inside them. Onboarding step 4 has no
  -- endpoint of its own, so its answers ride here (spec rule 11: onboarding
  -- keeps no data model of its own).
  goals               jsonb,
  units               text not null default 'metric'
                        check (units in ('metric', 'imperial')),
  -- Notification and AI feature toggles from the Settings tab. Shape is validated
  -- by zod at the edge; Postgres only guarantees it is an object.
  preferences         jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.users enable row level security;

create policy users_select_own on public.users
  for select using (auth.uid() = id);
create policy users_insert_own on public.users
  for insert with check (auth.uid() = id);
create policy users_update_own on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy users_delete_own on public.users
  for delete using (auth.uid() = id);

-- =============================================================================
-- exercises
--
-- Global, read-only reference data seeded from Free Exercise DB. Not user-owned,
-- so RLS is enabled with a blanket read policy rather than left off: that way the
-- table is readable by authenticated clients but not writable by them. Seeding
-- runs with the service-role key.
-- =============================================================================
create table public.exercises (
  id                uuid primary key default gen_random_uuid(),
  -- Stable slug from the upstream dataset, e.g. '3_4_Sit-Up'. Lets the seed
  -- script be re-run idempotently.
  external_id       text not null unique,
  name              text not null,
  muscle_group      text not null,
  secondary_muscles text[] not null default '{}',
  category          text not null,
  level             text not null,
  equipment         text,
  -- Always a URL. Exercise media is never stored as binary in the database or
  -- committed to the repository (spec rule 9).
  media_url         text,
  instructions      text[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index exercises_muscle_group_idx on public.exercises (muscle_group);
create index exercises_name_idx on public.exercises (lower(name));

alter table public.exercises enable row level security;

create policy exercises_select_all on public.exercises
  for select to authenticated using (true);

-- =============================================================================
-- routines
-- =============================================================================
create table public.routines (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 120),
  -- RoutineExercise[]: exercise id, denormalised name, sets, target reps/weight.
  exercises  jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index routines_user_idx on public.routines (user_id, created_at desc);

alter table public.routines enable row level security;

create policy routines_select_own on public.routines
  for select using (auth.uid() = user_id);
create policy routines_insert_own on public.routines
  for insert with check (auth.uid() = user_id);
create policy routines_update_own on public.routines
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy routines_delete_own on public.routines
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- workout_logs
--
-- `client_id` is the offline idempotency key. It is unique PER USER, not
-- globally: a global unique constraint would let one user's key permanently block
-- another user's write, turn a conflict response into an existence oracle, and
-- leak across the exact tenant boundary RLS exists to enforce.
--
-- `performed` records what was actually done. Without it a workout history could
-- only ever render a list of dates. `routine_name` is a snapshot and routine_id
-- is ON DELETE SET NULL, so editing or deleting a routine cannot rewrite history.
-- =============================================================================
create table public.workout_logs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users (id) on delete cascade,
  client_id        text not null check (char_length(client_id) between 8 and 128),
  routine_id       uuid references public.routines (id) on delete set null,
  routine_name     text not null,
  completed_at     timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  -- PerformedExercise[]: exercise id, name, and the sets with reps and weight.
  performed        jsonb not null default '[]'::jsonb,
  notes            text,
  -- When the row actually reached the server, as distinct from when the workout
  -- happened. The gap is the offline queue.
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint workout_logs_user_client_unique unique (user_id, client_id)
);

create index workout_logs_user_completed_idx
  on public.workout_logs (user_id, completed_at desc);

alter table public.workout_logs enable row level security;

create policy workout_logs_select_own on public.workout_logs
  for select using (auth.uid() = user_id);
create policy workout_logs_insert_own on public.workout_logs
  for insert with check (auth.uid() = user_id);
create policy workout_logs_update_own on public.workout_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy workout_logs_delete_own on public.workout_logs
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- custom_foods
-- =============================================================================
create table public.custom_foods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  client_id     text not null check (char_length(client_id) between 8 and 128),
  name          text not null check (char_length(trim(name)) between 1 and 200),
  brand         text,
  serving_label text not null default '1 serving',
  calories      numeric(10, 2) not null check (calories >= 0),
  protein_g     numeric(10, 2) not null default 0 check (protein_g >= 0),
  carbs_g       numeric(10, 2) not null default 0 check (carbs_g >= 0),
  fat_g         numeric(10, 2) not null default 0 check (fat_g >= 0),
  fiber_g       numeric(10, 2) check (fiber_g is null or fiber_g >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint custom_foods_user_client_unique unique (user_id, client_id)
);

create index custom_foods_user_name_idx on public.custom_foods (user_id, lower(name));

alter table public.custom_foods enable row level security;

create policy custom_foods_select_own on public.custom_foods
  for select using (auth.uid() = user_id);
create policy custom_foods_insert_own on public.custom_foods
  for insert with check (auth.uid() = user_id);
create policy custom_foods_update_own on public.custom_foods
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy custom_foods_delete_own on public.custom_foods
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- food_cache
--
-- Cache in front of USDA and Open Food Facts (spec rule 6), and the home for AI
-- photo estimates.
--
-- `kind` separates three things that would otherwise collide in one table: a
-- search by query string, a lookup of a single item by id, and a one-off AI
-- estimate. `user_id` is null for shared upstream data and set for an estimate,
-- so one user's estimate is not readable by another who guesses its id.
-- =============================================================================
create table public.food_cache (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('search', 'item', 'estimate')),
  source     text not null check (source in ('usda', 'open-food-facts', 'ai-photo-estimate')),
  -- Normalised search term, upstream item id, or 'estimate:<uuid>'.
  query      text not null,
  -- Owner, for estimates only. Null means shared reference data.
  user_id    uuid references public.users (id) on delete cascade,
  -- FoodItem or FoodItem[], depending on `kind`.
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  constraint food_cache_kind_source_query_unique unique (kind, source, query)
);

create index food_cache_query_idx on public.food_cache (kind, source, query);
create index food_cache_fetched_idx on public.food_cache (fetched_at);

alter table public.food_cache enable row level security;

-- Shared reference rows are readable by any authenticated user; an estimate is
-- readable only by the user it belongs to.
create policy food_cache_select_shared_or_own on public.food_cache
  for select to authenticated using (user_id is null or auth.uid() = user_id);

-- Writes to shared cache rows go through the service-role client. A user may
-- write their own estimate rows.
create policy food_cache_insert_own_estimate on public.food_cache
  for insert to authenticated with check (auth.uid() = user_id);

-- =============================================================================
-- food_log
--
-- Offline-syncable, so it carries a client_id like the other queued writes. The
-- spec left this out, which meant a user could create a custom food offline but
-- not log eating it.
--
-- Both the per-serving macros and the multiplier are stored. The resolved totals
-- are GENERATED columns so daily sums and the overview can aggregate directly in
-- SQL, and so history is frozen against later upstream changes. `food_name` is a
-- required snapshot: without it, deleting a custom food makes past days
-- unreadable.
-- =============================================================================
create table public.food_log (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  client_id          text not null check (char_length(client_id) between 8 and 128),
  -- Local calendar day the food was eaten, not the insert timestamp.
  date               date not null,
  -- Namespaced by source: 'usda:...', 'off:...', 'custom:...', 'estimate:...', 'manual:'.
  food_item_id       text not null,
  food_name          text not null,
  source             text not null check (
                       source in ('usda', 'open-food-facts', 'ai-photo-estimate', 'manual', 'custom')
                     ),
  serving_label      text not null default '1 serving',
  serving_multiplier numeric(8, 3) not null default 1 check (serving_multiplier > 0),
  meal               text check (meal is null or meal in ('breakfast', 'lunch', 'dinner', 'snack')),

  base_calories      numeric(10, 2) not null check (base_calories >= 0),
  base_protein_g     numeric(10, 2) not null default 0 check (base_protein_g >= 0),
  base_carbs_g       numeric(10, 2) not null default 0 check (base_carbs_g >= 0),
  base_fat_g         numeric(10, 2) not null default 0 check (base_fat_g >= 0),

  calories           numeric(12, 2) generated always as (base_calories * serving_multiplier) stored,
  protein_g          numeric(12, 2) generated always as (base_protein_g * serving_multiplier) stored,
  carbs_g            numeric(12, 2) generated always as (base_carbs_g * serving_multiplier) stored,
  fat_g              numeric(12, 2) generated always as (base_fat_g * serving_multiplier) stored,

  logged_at          timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint food_log_user_client_unique unique (user_id, client_id)
);

create index food_log_user_date_idx on public.food_log (user_id, date desc);

alter table public.food_log enable row level security;

create policy food_log_select_own on public.food_log
  for select using (auth.uid() = user_id);
create policy food_log_insert_own on public.food_log
  for insert with check (auth.uid() = user_id);
create policy food_log_update_own on public.food_log
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy food_log_delete_own on public.food_log
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- body_measurements
--
-- Deliberately NOT unique on (user_id, date): an upsert-per-day would conflict
-- with the client_id idempotency contract. Several entries per day are allowed and
-- the trend engine takes the latest entry per day, which is unit-tested.
-- =============================================================================
create table public.body_measurements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  client_id    text not null check (char_length(client_id) between 8 and 128),
  date         date not null,
  weight_kg    numeric(6, 2) not null check (weight_kg > 0 and weight_kg < 700),
  body_fat_pct numeric(5, 2) check (body_fat_pct is null or (body_fat_pct >= 0 and body_fat_pct <= 75)),
  -- TapeMeasurementsCm: neck, chest, waist, hips, thigh, arm, calf — all in cm.
  tape_cm      jsonb,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint body_measurements_user_client_unique unique (user_id, client_id)
);

create index body_measurements_user_date_idx on public.body_measurements (user_id, date desc);

alter table public.body_measurements enable row level security;

create policy body_measurements_select_own on public.body_measurements
  for select using (auth.uid() = user_id);
create policy body_measurements_insert_own on public.body_measurements
  for insert with check (auth.uid() = user_id);
create policy body_measurements_update_own on public.body_measurements
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy body_measurements_delete_own on public.body_measurements
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- body_comp_evaluations
--
-- Server-owned async state for the AI phrasing of a trend. A separate table
-- rather than columns on body_measurements, because that row is client-writable
-- and last-write-wins: an offline queue flush would clobber status and summary.
--
-- `trend` holds the deterministic result and is written synchronously, before the
-- AI call is made. The numbers are therefore durable even if the AI never
-- answers, and the first client poll can never race the insert.
-- =============================================================================
create table public.body_comp_evaluations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  measurement_id uuid not null references public.body_measurements (id) on delete cascade,
  status         text not null default 'pending'
                   check (status in ('pending', 'ready', 'failed')),
  -- ComputedTrend, computed deterministically. Never produced by AI (spec rule 4).
  trend          jsonb not null,
  -- AI phrasing of the above. Null until status = 'ready'.
  summary        text,
  provider       text,
  model          text,
  error_code     text,
  -- Retry bookkeeping for the lazy reaper; see services/body-composition/ai-evaluation.ts.
  attempts       integer not null default 0,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz,
  constraint body_comp_evaluations_measurement_unique unique (measurement_id)
);

create index body_comp_evaluations_user_created_idx
  on public.body_comp_evaluations (user_id, created_at desc);
-- Supports the reaper's hunt for stale pending rows.
create index body_comp_evaluations_pending_idx
  on public.body_comp_evaluations (status, started_at)
  where status = 'pending';

alter table public.body_comp_evaluations enable row level security;

create policy body_comp_evaluations_select_own on public.body_comp_evaluations
  for select using (auth.uid() = user_id);
create policy body_comp_evaluations_insert_own on public.body_comp_evaluations
  for insert with check (auth.uid() = user_id);
create policy body_comp_evaluations_update_own on public.body_comp_evaluations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =============================================================================
-- push_subscriptions
--
-- A table rather than a column on users, so one account can be registered from
-- several devices or browsers — which is the normal case for a PWA.
-- =============================================================================
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  -- OneSignal's per-device identifier. No health data is ever put in a payload.
  player_id  text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_user_player_unique unique (user_id, player_id)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- =============================================================================
-- subscriptions
--
-- Billing placeholder. Always plan 'free', is_premium false: the Premium upsell
-- is non-functional and no gateway is integrated. unique(user_id) prevents the
-- duplicate rows that would otherwise accumulate from a repeated ensureFree call.
-- =============================================================================
create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  plan       text not null default 'free' check (plan in ('free', 'premium')),
  is_premium boolean not null default false,
  renews_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_user_unique unique (user_id)
);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);
create policy subscriptions_insert_own on public.subscriptions
  for insert with check (auth.uid() = user_id);

-- =============================================================================
-- updated_at maintenance
-- =============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();
create trigger routines_touch_updated_at
  before update on public.routines
  for each row execute function public.touch_updated_at();
create trigger custom_foods_touch_updated_at
  before update on public.custom_foods
  for each row execute function public.touch_updated_at();
create trigger body_measurements_touch_updated_at
  before update on public.body_measurements
  for each row execute function public.touch_updated_at();
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();
