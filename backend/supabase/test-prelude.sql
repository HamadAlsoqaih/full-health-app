-- =============================================================================
-- Local-only stand-in for the parts of a Supabase project that 0001_init.sql
-- depends on but does not create: the auth schema, auth.users, auth.uid() and
-- the anon/authenticated roles.
--
-- This is NOT applied to a real Supabase project — it already has all of this.
-- It exists so the migration, its constraints and its row-level security
-- policies can be applied and exercised against a throwaway Postgres instance.
-- See backend/supabase/verify-migration.sh.
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text not null unique
);

-- Supabase derives the current user from the request JWT. Here it is read from a
-- session GUC so a test can impersonate a user with `set local request.jwt.uid`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.uid', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant select on auth.users to authenticated;
