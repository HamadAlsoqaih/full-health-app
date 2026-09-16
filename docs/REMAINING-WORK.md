# What is left, and where to pick it up

An honest inventory. Everything here is either deliberately unbuilt, impossible to
verify from the build environment, or a known limitation worth knowing about before
it surprises you.

Nothing in this list is hidden behind an optimistic "TODO" in the code — each item
names the file where the work starts.

---

## 1. Deliberately stubbed — the build spec said not to implement these

| What              | Where                                                         | State                                                                                                    |
| ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| AI guide / mascot | `frontend/src/features/ai-guide/`                             | `MascotWidget` renders `null`; `useMascot` returns `{ enabled: false }`. Not mounted anywhere.           |
| AI agent service  | `backend/src/services/ai/ai-agent.service.ts`                 | Throws if constructed. No conversation logic.                                                            |
| Moyasar payments  | `backend/src/services/billing/providers/moyasar.provider.ts`  | Every method throws. `enabled: false`. Not wired to any route.                                           |
| Premium purchase  | `frontend/src/features/settings/components/PremiumUpsell.tsx` | Expands to show what Premium _would_ include, and says plainly that nothing is purchasable. No checkout. |

`billing.service.ts` returns a hardcoded `{ plan: 'free', isPremium: false }` for
every user without touching the database. `subscriptionRepository.ensureFree`
exists, is idempotent, and is deliberately not called during registration — a
two-write signup that can half-fail buys nothing while there is no real plan.

**To add real payments:** implement `PaymentProvider` in `moyasar.provider.ts`, then
have `billing.service.ts` delegate to it. The interface is the same swappable
pattern as the AI provider, so nothing else needs reshaping. Moyasar is the sensible
default for a Saudi-registered merchant — published pricing, no monthly fee, Mada
support. Stripe's support for Saudi merchants is not clearly established; check
before assuming it.

---

## 2. Built on the backend, not yet connected on the frontend

**Push notification registration.** The backend is complete: the
`push_subscriptions` table, `POST /api/notifications/subscribe`, preference-aware
dispatch in `notifications.service.ts`, the OneSignal client, and a test asserting
the evaluation-ready notification fires exactly once. The **frontend never calls
it** — the OneSignal web SDK is not loaded and no player id is ever obtained.

Start at: `frontend/src/shared/lib/pushNotifications.ts` (does not exist yet; the
spec's folder plan has a slot for it). It needs to load the OneSignal SDK using
`VITE_ONESIGNAL_APP_ID`, request permission at a sensible moment — _not_ on first
launch, which is how permission prompts get denied permanently — and post the
resulting player id to `settingsApi.registerPush`, which is already written.

---

## 3. Could not be verified from the build environment

These are written and type-checked, and their parsing logic is unit-tested against
checked-in fixtures, but **no call has ever reached the real service**:

| Integration                              | Why not verified                                               |
| ---------------------------------------- | -------------------------------------------------------------- |
| Supabase (auth, queries, RLS at runtime) | No project, no credentials                                     |
| Google Gemini (vision + text)            | No API key                                                     |
| Groq                                     | No API key                                                     |
| USDA FoodData Central                    | `api.nal.usda.gov` blocked by the environment's network policy |
| Open Food Facts                          | `world.openfoodfacts.org` blocked by the same policy           |
| OneSignal delivery                       | No credentials                                                 |
| Sentry ingestion                         | No DSN                                                         |

What _was_ verified for real:

- **Free Exercise DB**: reachable, 876 exercises parsed, 0 skipped, exactly 3
  without images, media URLs resolve (HTTP 200).
- **The schema**: applied to a real Postgres 16, with 22 assertions over its
  constraints and RLS policies.
- **Everything else**: 167 tests across both workspaces.

**First thing to do after adding credentials:** register a user, walk the onboarding
flow, log a food and a workout, and record two weigh-ins. That exercises the
Supabase auth path, the RLS-scoped repositories, and the idempotency keys against
the real database in one pass.

---

## 4. Known limitations, stated rather than buried

**Row-level security is real but unverified at runtime.** The backend forwards each
caller's JWT with the anon key so `auth.uid()` resolves and the policies apply —
rather than using the service-role key, which bypasses RLS entirely and would make
every policy decorative. Repositories _also_ filter on `user_id` regardless, because
RLS is the layer the credential-free suite cannot reach and must never be the only
defence. `verify-migration.sh` closes most of that gap against a local Postgres, but
it has never run against Supabase's own `auth.uid()`.

**Token validation costs a round trip.** `getUserFromToken` asks Supabase to
validate on every authenticated request. Verifying the JWT locally against the
project's JWKS would remove that hop. Deliberately not done: a hand-rolled JWT
verification that is subtly wrong is far worse than a network call. Start at
`backend/src/services/auth/auth.service.ts`.

**Rate limit counters are in-process.** `express-rate-limit`'s default store resets
when the host restarts, which a sleeping free tier does often. They exist to stop
accidental self-inflicted quota exhaustion, not a determined attacker. A
multi-instance deployment needs a shared store.

**The AI vision daily cap is also in-process** and resets on restart, for the same
reason. Same file: `backend/src/middlewares/rate-limit.middleware.ts`.

**"Next routine" is a heuristic, not a schedule.** `overview.service.ts` surfaces
the routine you have not done for longest. There is no scheduling model. A real one
needs its own table.

**Last-write-wins is currently vacuous.** The spec calls for it on the
offline-syncable tables, and `created_at`/`updated_at` exist to support it — but all
four are append-only with no update path, and the idempotency key prevents
duplicates. So no merge logic was built, on purpose, rather than speculatively.

**Meal photos are never stored.** Streamed to the AI provider in memory and
discarded; only the resulting estimate is kept. This was a deliberate choice (the
cheapest PDPL posture, and no bucket or retention rule to get wrong). Adding a photo
history means a Supabase Storage bucket with its own RLS policy, a retention rule,
and a rewrite of the privacy policy's "Meal photographs" section — which currently
states plainly that nothing is retained.

**No routine reordering.** Drag-and-drop on touch is a real piece of work and a
half-built one is worse than none. `RoutineBuilder.tsx`.

**No food log editing.** An entry can be deleted and re-added, but not edited in
place. `DELETE /api/nutrition/log/:id` exists; there is no PUT.

**No data export.** Listed in the Premium teaser. The deletion right is enforced by
database cascades; export is not built.

---

## 5. Deployment (build spec step 15)

Not done, and not doable from here — both are dashboard steps. Full instructions are
in `docs/SETUP.md` §8. In short:

- **Render** (backend): connect the repo, set the build and start commands, paste
  the backend environment variables. **Do not use Render's own free Postgres** — it
  expires after 30 days.
- **Cloudflare Pages** (frontend): connect the repo, set the build command and
  output directory, add the three `VITE_*` variables.

Both auto-deploy from `main` via their own GitHub integrations, which is simpler than
scripting deploys in Actions. CI stays a gate.

---

## 6. Legal and regulatory — genuinely open

**The legal templates are drafts.** `legal/privacy-policy.md` and
`legal/terms-of-service.md` each open with a banner saying they are not legal advice
and require review, and both are full of `[BRACKETED]` placeholders that must be
filled in.

**The PDPL data-residency question is unresolved.** Saudi Arabia's Personal Data
Protection Law restricts transferring personal data outside the Kingdom and attaches
particular conditions to sensitive data — which health data is. This app stores
weight, body-fat percentage, tape measurements and food logs on Supabase
infrastructure that is not in Saudi Arabia. The privacy policy flags this with a
specific list of questions for a lawyer. **It is a real question, not a formality**,
and it may require in-Kingdom hosting or an explicit transfer mechanism.

**Vendor free-tier claims are unverified.** Every limit mentioned — Render's idle
sleep and Postgres expiry, Supabase's storage and pause behaviour, OneSignal's web
push allowance, Gemini's daily requests, USDA's hourly rate — comes from the original
build specification. All those pricing pages are blocked from the build environment,
so none of it could be checked. Verify anything you intend to rely on commercially.

---

## 7. Toolchain notes worth knowing

**TypeScript is pinned to 5.9, not 7.x.** `typescript-eslint@8.70` declares a peer
range of `>=4.8.4 <6.1.0`, so moving to 7 today would leave the repository
unlintable. Revisit when typescript-eslint supports it.

**`@app/shared-types` is consumed as TypeScript source**, not built to JavaScript, so
a cold clone typechecks with no build-order step. `tsc` does not rewrite path aliases
in its output, so the backend's runtime artifact is bundled with esbuild
(`backend/esbuild.config.mjs`), which resolves the alias to the real source file.

**Theme tokens are code-generated.** `frontend/src/shared/theme/tokens.ts` is the
only place a colour, type size, radius or named length is written.
`scripts/generate-theme-css.ts` emits `theme.generated.css` from it, and CI asserts
the generated file is not stale. Edit the tokens file, never the CSS.
