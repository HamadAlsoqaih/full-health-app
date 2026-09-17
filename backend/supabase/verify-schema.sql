-- =============================================================================
-- Exercises the schema's constraints and row-level security policies against a
-- throwaway Postgres instance. Run via backend/supabase/verify-migration.sh.
--
-- Row-level security is the one protection the credential-free test suite cannot
-- otherwise cover: there is no live Postgres in unit tests to evaluate auth.uid()
-- against. That is exactly why it is verified here, and why the repository layer
-- also filters by user_id regardless.
--
-- Every statement below asserts. The script fails loudly rather than printing
-- something a reader has to interpret.
-- =============================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end $$;

-- Asserts that a statement violates a constraint, naming the sqlstate expected.
create or replace function assert_rejected(stmt text, expected_sqlstate text, label text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = expected_sqlstate then
      raise notice 'PASS  % (rejected with %)', label, sqlstate;
      return;
    end if;
    raise exception 'FAIL  % — expected sqlstate %, got % (%)',
      label, expected_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % — statement was accepted but should have been rejected', label;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two users, so cross-tenant behaviour can be asserted.
-- ---------------------------------------------------------------------------
\set alice '11111111-1111-1111-1111-111111111111'
\set bob   '22222222-2222-2222-2222-222222222222'

insert into auth.users (id, email) values
  (:'alice', 'alice@example.com'),
  (:'bob',   'bob@example.com');
insert into public.users (id, email) values
  (:'alice', 'alice@example.com'),
  (:'bob',   'bob@example.com');

-- ---------------------------------------------------------------------------
-- Generated macro columns
-- ---------------------------------------------------------------------------
insert into public.food_log (user_id, client_id, date, food_item_id, food_name, source,
                             serving_multiplier, base_calories, base_protein_g, base_carbs_g, base_fat_g)
values (:'alice', 'fl-alice-0001', '2026-09-16', 'usda:12345', 'Oats', 'usda',
        1.5, 250, 10, 40, 5);

select assert(
  (select calories = 375 and protein_g = 15 and carbs_g = 60 and fat_g = 7.5
     from public.food_log where client_id = 'fl-alice-0001'),
  'food_log resolves base macros x serving_multiplier');

-- ---------------------------------------------------------------------------
-- Idempotency key scope. This is the pair of assertions that justifies
-- unique(user_id, client_id) over a global unique(client_id).
-- ---------------------------------------------------------------------------
select assert_rejected(
  $$insert into public.food_log (user_id, client_id, date, food_item_id, food_name, source, base_calories)
    values ('11111111-1111-1111-1111-111111111111', 'fl-alice-0001', '2026-09-16', 'usda:9', 'Dup', 'usda', 1)$$,
  '23505',
  'same user replaying the same client_id is rejected');

insert into public.food_log (user_id, client_id, date, food_item_id, food_name, source, base_calories)
values (:'bob', 'fl-alice-0001', '2026-09-16', 'usda:9', 'Bob food', 'usda', 99);

select assert(
  (select count(*) = 2 from public.food_log where client_id = 'fl-alice-0001'),
  'a different user may reuse the same client_id (no cross-tenant key collision)');

-- Same assertions for the other three offline-syncable tables.
insert into public.body_measurements (user_id, client_id, date, weight_kg)
values (:'alice', 'shared-key-01', '2026-09-16', 80);
insert into public.body_measurements (user_id, client_id, date, weight_kg)
values (:'bob', 'shared-key-01', '2026-09-16', 90);
select assert_rejected(
  $$insert into public.body_measurements (user_id, client_id, date, weight_kg)
    values ('11111111-1111-1111-1111-111111111111', 'shared-key-01', '2026-09-17', 81)$$,
  '23505', 'body_measurements client_id is unique per user');

insert into public.custom_foods (user_id, client_id, name, calories)
values (:'alice', 'shared-key-01', 'Alice shake', 300);
insert into public.custom_foods (user_id, client_id, name, calories)
values (:'bob', 'shared-key-01', 'Bob shake', 400);
select assert(
  (select count(*) = 2 from public.custom_foods where client_id = 'shared-key-01'),
  'custom_foods client_id is unique per user, not globally');

insert into public.workout_logs (user_id, client_id, routine_name, completed_at)
values (:'alice', 'shared-key-01', 'Push A', now());
insert into public.workout_logs (user_id, client_id, routine_name, completed_at)
values (:'bob', 'shared-key-01', 'Pull B', now());
select assert(
  (select count(*) = 2 from public.workout_logs where client_id = 'shared-key-01'),
  'workout_logs client_id is unique per user, not globally');

-- ---------------------------------------------------------------------------
-- Value constraints
-- ---------------------------------------------------------------------------
select assert_rejected(
  $$insert into public.body_measurements (user_id, client_id, date, weight_kg)
    values ('11111111-1111-1111-1111-111111111111', 'bm-bad-1', '2026-09-16', -5)$$,
  '23514', 'negative weight is rejected');

select assert_rejected(
  $$insert into public.body_measurements (user_id, client_id, date, weight_kg, body_fat_pct)
    values ('11111111-1111-1111-1111-111111111111', 'bm-bad-2', '2026-09-16', 80, 99)$$,
  '23514', 'body-fat percentage above the plausible ceiling is rejected');

select assert_rejected(
  $$insert into public.food_log (user_id, client_id, date, food_item_id, food_name, source,
                                 serving_multiplier, base_calories)
    values ('11111111-1111-1111-1111-111111111111', 'fl-bad-1', '2026-09-16', 'usda:1', 'Z', 'usda', 0, 10)$$,
  '23514', 'a zero serving multiplier is rejected');

select assert_rejected(
  $$insert into public.food_log (user_id, client_id, date, food_item_id, food_name, source, base_calories)
    values ('11111111-1111-1111-1111-111111111111', 'fl-bad-2', '2026-09-16', 'x:1', 'Z', 'not-a-source', 10)$$,
  '23514', 'an unknown food source is rejected');

select assert_rejected(
  $$insert into public.workout_logs (user_id, client_id, routine_name, completed_at)
    values ('11111111-1111-1111-1111-111111111111', 'short', 'R', now())$$,
  '23514', 'a client_id shorter than the minimum is rejected');

-- ---------------------------------------------------------------------------
-- Several measurements on one day are deliberately allowed: an upsert-per-day
-- would conflict with the client_id idempotency contract. The trend engine
-- resolves the ambiguity by taking the latest entry per day.
-- ---------------------------------------------------------------------------
insert into public.body_measurements (user_id, client_id, date, weight_kg) values
  (:'alice', 'bm-alice-same-day-a', '2026-09-20', 80.5),
  (:'alice', 'bm-alice-same-day-b', '2026-09-20', 80.1);
select assert(
  (select count(*) = 2 from public.body_measurements
    where user_id = :'alice' and date = '2026-09-20'),
  'multiple measurements on one day are allowed');

-- ---------------------------------------------------------------------------
-- History survives routine deletion: routine_id nulls out, the snapshot remains.
-- ---------------------------------------------------------------------------
insert into public.routines (id, user_id, name)
values ('33333333-3333-3333-3333-333333333333', :'alice', 'Leg Day');
insert into public.workout_logs (user_id, client_id, routine_id, routine_name, completed_at)
values (:'alice', 'wl-alice-legday', '33333333-3333-3333-3333-333333333333', 'Leg Day', now());
delete from public.routines where id = '33333333-3333-3333-3333-333333333333';
select assert(
  (select routine_id is null and routine_name = 'Leg Day'
     from public.workout_logs where client_id = 'wl-alice-legday'),
  'deleting a routine nulls the reference but preserves workout history');

-- ---------------------------------------------------------------------------
-- Row-level security. Impersonate a user the way Supabase does, by role plus a
-- JWT-derived uid, and confirm the policies actually isolate tenants.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;

do $$
declare
  visible       int;
  foreign_rows  int;
begin
  set local role authenticated;
  perform set_config('request.jwt.uid', '11111111-1111-1111-1111-111111111111', true);

  -- The security property is not "I see N rows" (which changes whenever a fixture
  -- is added) but "I see none of anyone else's". Assert that directly.
  select count(*) into visible from public.food_log;
  select count(*) into foreign_rows from public.food_log
   where user_id <> '11111111-1111-1111-1111-111111111111';
  if visible = 0 then
    raise exception 'FAIL  RLS: a user cannot see their own food_log rows at all';
  end if;
  if foreign_rows <> 0 then
    raise exception 'FAIL  RLS: % of another user''s food_log rows were visible', foreign_rows;
  end if;
  raise notice 'PASS  RLS: food_log shows own rows (%) and no other user''s', visible;

  select count(*) into visible from public.body_measurements;
  select count(*) into foreign_rows from public.body_measurements
   where user_id <> '11111111-1111-1111-1111-111111111111';
  if visible = 0 or foreign_rows <> 0 then
    raise exception 'FAIL  RLS: body_measurements leaked or hid rows (own %, foreign %)',
      visible, foreign_rows;
  end if;
  raise notice 'PASS  RLS: body_measurements shows own rows (%) and no other user''s', visible;

  select count(*) into foreign_rows from public.custom_foods
   where user_id <> '11111111-1111-1111-1111-111111111111';
  if foreign_rows <> 0 then
    raise exception 'FAIL  RLS: another user''s custom_foods were visible';
  end if;
  raise notice 'PASS  RLS: custom_foods are isolated per user';

  select count(*) into foreign_rows from public.workout_logs
   where user_id <> '11111111-1111-1111-1111-111111111111';
  if foreign_rows <> 0 then
    raise exception 'FAIL  RLS: another user''s workout_logs were visible';
  end if;
  raise notice 'PASS  RLS: workout_logs are isolated per user';

  -- Writing a row attributed to someone else must fail the policy's WITH CHECK.
  begin
    insert into public.body_measurements (user_id, client_id, date, weight_kg)
    values ('22222222-2222-2222-2222-222222222222', 'bm-forged-1', '2026-09-16', 70);
    raise exception 'FAIL  RLS: a user was able to insert a row owned by another user';
  exception when insufficient_privilege then
    raise notice 'PASS  RLS: inserting a row owned by another user is blocked';
  end;

  -- Updating another user's row must find nothing to update rather than succeed.
  update public.body_measurements set weight_kg = 1
   where user_id = '22222222-2222-2222-2222-222222222222';
  if found then
    raise exception 'FAIL  RLS: a user was able to update another user''s measurement';
  end if;
  raise notice 'PASS  RLS: updating another user''s row affects nothing';

  -- =========================================================================
  -- The two-pass photo scan replaces its own estimate row.
  --
  -- This is the assertion that would have caught a 500 on every photo
  -- refinement. The second pass writes the revised estimate under the SAME id,
  -- food_cache is unique on (kind, source, query), and the repository used a
  -- plain INSERT — so a successful model call was followed by a 23505. The
  -- credential-free suite could not see it: its fake is an array with no
  -- constraint. Only real Postgres can answer this, so it is asked here.
  --
  -- It needs BOTH halves to pass: the unique constraint makes it an upsert, and
  -- the UPDATE policy from 0002 is what lets the update half through RLS.
  -- =========================================================================
  insert into public.food_cache (kind, source, query, user_id, payload)
  values ('estimate', 'ai-photo-estimate', 'estimate:verify-1',
          '11111111-1111-1111-1111-111111111111', '{"calories": 1800}'::jsonb);

  insert into public.food_cache (kind, source, query, user_id, payload)
  values ('estimate', 'ai-photo-estimate', 'estimate:verify-1',
          '11111111-1111-1111-1111-111111111111', '{"calories": 2520}'::jsonb)
  on conflict (kind, source, query)
    do update set payload = excluded.payload, fetched_at = now();

  select count(*) into visible from public.food_cache
   where kind = 'estimate' and query = 'estimate:verify-1';
  if visible <> 1 then
    raise exception 'FAIL  food_cache: refining left % estimate rows, expected 1', visible;
  end if;

  perform 1 from public.food_cache
   where query = 'estimate:verify-1' and (payload->>'calories')::int = 2520;
  if not found then
    raise exception 'FAIL  food_cache: the refined estimate did not replace the first one';
  end if;
  raise notice 'PASS  food_cache: a refined estimate replaces its own row under RLS';

  -- The same must NOT be possible against a row owned by someone else: the
  -- unique constraint has no user_id in it, so a colliding id from another
  -- account must be refused rather than silently rewritten.
  begin
    insert into public.food_cache (kind, source, query, user_id, payload)
    values ('estimate', 'ai-photo-estimate', 'estimate:verify-1',
            '22222222-2222-2222-2222-222222222222', '{"calories": 1}'::jsonb)
    on conflict (kind, source, query)
      do update set payload = excluded.payload;
    raise exception 'FAIL  RLS: a user rewrote another user''s estimate via upsert';
  exception when insufficient_privilege then
    raise notice 'PASS  RLS: upserting onto another user''s estimate is blocked';
  end;

  -- Reference data stays readable.
  perform 1 from public.exercises limit 1;
  raise notice 'PASS  RLS: reference exercise data is readable by an authenticated user';
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Deleting the auth user must cascade to every health record. This is what
-- makes the deletion right in the privacy policy enforceable at the database
-- level rather than dependent on application code remembering.
-- ---------------------------------------------------------------------------
delete from auth.users where id = :'alice';

do $$
declare
  leftovers int;
begin
  select
    (select count(*) from public.users              where id      = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.food_log           where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.body_measurements  where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.custom_foods       where user_id = '11111111-1111-1111-1111-111111111111')
  + (select count(*) from public.workout_logs       where user_id = '11111111-1111-1111-1111-111111111111')
  into leftovers;

  if leftovers <> 0 then
    raise exception 'FAIL  deleting the auth user left % orphaned rows', leftovers;
  end if;
  raise notice 'PASS  deleting the auth user cascades to every health record';
end $$;

-- Bob is untouched.
do $$
declare bob_rows int;
begin
  select count(*) into bob_rows from public.food_log
   where user_id = '22222222-2222-2222-2222-222222222222';
  if bob_rows <> 1 then
    raise exception 'FAIL  deleting one user affected another, bob has % rows', bob_rows;
  end if;
  raise notice 'PASS  deleting one user does not affect another';
end $$;
