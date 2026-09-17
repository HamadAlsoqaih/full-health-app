-- =============================================================================
-- 0002 — let a user replace their own AI photo estimate
--
-- WHY THIS EXISTS
--
-- The two-pass photo scan revises an estimate under the SAME id: the first pass
-- writes a `food_cache` row with kind 'estimate', the second pass replaces its
-- payload with the numbers the user's answers produced. `food_cache` is unique
-- on (kind, source, query), so that replacement has to be an upsert.
--
-- 0001 gave `food_cache` a SELECT policy and an INSERT policy and nothing else,
-- because the first pass never needed more. The upsert's UPDATE half was
-- therefore refused by row-level security, and before that the plain insert it
-- replaced failed the unique constraint outright — every refinement returned a
-- 500. The credential-free test suite could not see either failure: the
-- in-memory repository fake has neither a unique constraint nor RLS.
--
-- SAFE TO RE-RUN. Nothing here drops or rewrites data.
-- =============================================================================

-- A user may replace the payload of an estimate row they own.
--
-- `using` decides which rows are visible to the update; `with check` decides
-- what the updated row is allowed to look like. Both are required — without the
-- second, a user could hand their row to another account by rewriting user_id.
--
-- Shared reference rows (user_id is null) are deliberately NOT covered: those
-- are written by the service-role client, and a user has no business editing the
-- cached USDA response everyone else reads.
create policy food_cache_update_own_estimate on public.food_cache
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
