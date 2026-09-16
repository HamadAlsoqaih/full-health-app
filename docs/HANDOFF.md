# Handoff

Everything asked for in the build specification is implemented, committed, pushed
and green in CI. This is the state of things, what to do next, and what you should
not trust without checking.

- **Repository:** `HamadAlsoqaih/full-health-app`
- **Branch:** `claude/laughing-hawking-p0wu6x` → **[PR #1](https://github.com/HamadAlsoqaih/full-health-app/pull/1)** into `main`
- **CI:** green — both the `verify` gate and the `schema` job
- **Authored entirely by you.** No AI attribution in any commit or in the PR body.

---

## Where it stands

|                   |                                            |
| ----------------- | ------------------------------------------ |
| Commits           | 11, each one a coherent step               |
| Files             | ~175                                       |
| Lines             | ~19,900                                    |
| Tests             | **167** passing (136 backend, 31 frontend) |
| Schema assertions | **22** against a real Postgres, in CI      |
| Build             | Clean. 143 kB gzipped initial load         |

Build order steps 1–14 are done. Step 15 (deployment) is dashboard configuration
that cannot be scripted from here; it is written up in `docs/SETUP.md` §8.

---

## Do these three things first

**1. Review and merge PR #1.** It is large because it is an initial build. The
commits are ordered so you can read them in sequence: scaffolding → types → schema
→ backend → frontend → docs.

**2. Stand up Supabase and seed the exercises.** Follow `docs/SETUP.md` §1 and §2.
About ten minutes. Until this is done the app cannot run and the Training tab is
empty.

**3. Walk the app once with real credentials.** Register, go through onboarding, log
a food and a workout, record two weigh-ins. That single pass exercises the Supabase
auth path, the RLS-scoped repositories and the idempotency keys against a real
database — **none of which has ever run against a live service.** Everything is
tested against fakes and fixtures; nothing has been tested against Supabase itself.

---

## What you should not trust yet

Stated plainly, because these are the things that will bite:

**No integration has touched a live service.** No credentials existed in the build
environment, and the USDA and Open Food Facts hosts were blocked by its network
policy. Parsing logic is covered by checked-in fixtures; transport is not. That
applies to Supabase, Gemini, Groq, USDA, Open Food Facts, OneSignal and Sentry.

**RLS has never run against Supabase's own `auth.uid()`.** The policies are verified
against a local Postgres with a stand-in implementation (22 assertions, in CI), and
repositories filter on `user_id` independently as a second line of defence. But the
real thing is unproven.

**Every vendor free-tier figure is unverified.** Render's idle sleep and Postgres
expiry, Supabase's limits, OneSignal's web-push allowance, Gemini's daily requests,
USDA's hourly rate — all of it comes from the original specification. Every one of
those pricing pages was unreachable from the build environment. Check anything you
intend to depend on commercially.

**The legal documents are drafts.** `legal/privacy-policy.md` and
`legal/terms-of-service.md` open with a banner saying they are not legal advice and
are full of `[BRACKETED]` placeholders. They are a checklist against omission.

**The PDPL data-residency question is open, and it is a real one.** This app stores
weight, body-fat percentage, tape measurements and food logs — health data, which is
sensitive data — on Supabase infrastructure that is **not in Saudi Arabia**. The PDPL
restricts transferring personal data outside the Kingdom. The privacy policy flags it
with a specific list of questions for a lawyer. It may require in-Kingdom hosting or
an explicit transfer mechanism. Nothing in this repository resolves it.

**Push notifications are half-wired.** The backend is complete and tested — table,
endpoint, preference-aware dispatch, and a test asserting the evaluation-ready
notification fires exactly once. The frontend never calls it. See
`docs/REMAINING-WORK.md` §2 for where to start.

---

## Decisions made on your behalf

Each is recorded with its reasoning in `docs/DEVIATIONS.md`. Reverse any you
disagree with — they are documented, not hidden.

**The specification contradicted itself twice, and both had to be resolved:**

- Onboarding answers were to be held "client-side only" yet survive the app closing
  mid-flow. Read as _not on the server_: the draft persists to `localStorage`, and
  progress is derived server-side from the two domains onboarding seeds, so it still
  has no data model of its own.
- RLS was mandated on every table _and_ the backend was handed the service-role key,
  which bypasses RLS entirely. The caller's JWT is forwarded with the anon key
  instead; the service-role key is confined to one module and that boundary is
  enforced by a linter rule rather than a comment.

**Three security problems in the specified API were fixed:** mass assignment on
`PUT /users/me`, a globally-unique idempotency key that let one user block another's
writes, and an unbounded photo upload.

**Several schema gaps were closed**, most consequentially: nothing cascaded from
`auth.users`, so deleting an account orphaned its health data — directly
contradicting the deletion right the privacy policy has to promise.

**Five bugs were found by the tests rather than by review**, including an evaluation
endpoint that stalled for 20 seconds behind a hung AI provider, and a frontend
session store that left a user stranded after a failed token refresh.

---

## How to work on it

```bash
npm ci
npm run lint && npm run build && npm test     # passes with no .env at all
npm run dev                                    # API :8080, web :5173
./backend/supabase/verify-migration.sh         # schema + RLS, needs local Postgres
```

Three things worth knowing before you change anything:

- **Design tokens are generated.** Edit `frontend/src/shared/theme/tokens.ts`, never
  `theme.generated.css`. CI fails if they drift. The `accent` colour is a deliberate
  placeholder — replace it there and the whole app follows.
- **`AppRouter.tsx` is the only place that decides routing.** Do not add an auth or
  onboarding check inside a feature screen; the decision has six inputs and two
  copies will eventually disagree.
- **Writes that can be queued offline go through the outbox**, which owns retrying
  with an idempotency key. Never add an automatic retry around one of those
  mutations.

Test it on a phone-sized viewport, not a desktop window. The layout, the safe-area
padding and the tap targets are all built for a phone.

---

## Reading order

|                          |                                                  |
| ------------------------ | ------------------------------------------------ |
| `README.md`              | Orientation                                      |
| `docs/SETUP.md`          | **Start here to run it** — every service and key |
| `docs/REMAINING-WORK.md` | **What is left and where to pick it up**         |
| `docs/ARCHITECTURE.md`   | How it fits together and why                     |
| `docs/DEVIATIONS.md`     | Where this departs from your spec, and why       |
| `docs/DATA-MODEL.md`     | Schema and reasoning                             |
| `docs/API.md`            | Endpoint reference                               |
| `docs/OFFLINE.md`        | The outbox and idempotency                       |
| `docs/TESTING.md`        | What is covered, and what is not                 |

---

Not a medical device. Every figure it produces is computed from what the user logs,
and the body-composition analysis is deterministic arithmetic — the AI layer only
rewords an already-final result.
