# Full Health

A fitness, nutrition and body-composition tracking PWA. Five tabs behind an
onboarding-then-signup flow: today's snapshot, training, nutrition, body composition
and settings.

```
packages/shared-types/   Wire types shared by both sides. Declared once.
backend/                 Express + TypeScript API
frontend/                React + Vite PWA
legal/                   Privacy policy and terms — TEMPLATES, not reviewed
docs/                    Architecture, setup, API, data model, testing, and what's left
```

---

## Quick start

```bash
npm ci
npm run lint && npm run build && npm test
```

**That passes on a fresh clone with no credentials of any kind.** Every external
service sits behind an injected port, so the whole suite runs without Supabase, API
keys or network access.

To actually run the app you need a Supabase project and to seed the exercise
library. **[docs/SETUP.md](docs/SETUP.md)** walks through every service, which value
to copy from where, and which environment variable it belongs in.

```bash
npm run dev      # API on :8080, web app on :5173
```

---

## What it does

- **Overview** — calories logged against target, next routine, the weight trend, in
  one aggregated request.
- **Training** — 876 exercises from Free Exercise DB, user-built routines, and a
  player that records the sets, reps and weight actually performed. Works offline.
- **Nutrition** — search across USDA, Open Food Facts and your own foods; custom
  foods; and a meal-photo estimate that is **never logged without confirmation**.
  Everything but the photo scan works offline.
- **Body composition** — weight, body fat and tape measurements, with a trend
  computed **deterministically** (never by AI) and a plain-language recommendation.
- **Settings** — units, notification and AI toggles, and a Premium placeholder that
  takes no money and says so.

---

## Tests

```bash
npm test                                 # 167 tests
./backend/supabase/verify-migration.sh   # 24 schema + RLS assertions (needs Postgres)
```

|              |                                       |
| ------------ | ------------------------------------- |
| Backend      | 136 tests across 8 files              |
| Frontend     | 31 tests across 2 files               |
| Schema / RLS | 24 assertions against a real Postgres |

See **[docs/TESTING.md](docs/TESTING.md)** for what is covered, and what is not.

---

## A few things worth knowing before reading the code

**Row-level security is real.** The backend forwards each caller's JWT with the anon
key so `auth.uid()` resolves and the policies apply — rather than using the
service-role key, which bypasses RLS entirely. Repositories filter on `user_id`
anyway, because RLS is the one layer the credential-free suite cannot reach.

**Offline writes are idempotent.** A client-minted UUID doubles as the server's
idempotency key, unique **per user**. A replay returns 200 with the stored row, so a
retried sync can never duplicate.

**The body-composition analysis is arithmetic, not AI.** The AI layer only rephrases
an already-final result, which is why switching AI off costs you the prose and not
the analysis.

**There is no job queue.** One async job does not justify Redis, so the AI evaluation
is a plain unawaited function with a reaper on the read path, an attempt ceiling and
conditional state transitions.

**Design tokens are code-generated.** `frontend/src/shared/theme/tokens.ts` is the
only place a colour, type size, radius or named length is written; CI asserts the
generated CSS is not stale.

**The spec was corrected in places.** Every deviation — including a mass-assignment
hole, a cross-tenant idempotency bug and an RLS contradiction — is listed with its
reasoning in **[docs/DEVIATIONS.md](docs/DEVIATIONS.md)**.

---

## Documentation

|                                                  |                                                 |
| ------------------------------------------------ | ----------------------------------------------- |
| [docs/SETUP.md](docs/SETUP.md)                   | Every service, every key, where each comes from |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | How it fits together and why                    |
| [docs/API.md](docs/API.md)                       | Endpoint reference                              |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md)         | Schema and the reasoning behind it              |
| [docs/OFFLINE.md](docs/OFFLINE.md)               | The outbox and idempotency in detail            |
| [docs/TESTING.md](docs/TESTING.md)               | Coverage, and the gaps                          |
| [docs/DEVIATIONS.md](docs/DEVIATIONS.md)         | Where this departs from the spec                |
| [docs/REMAINING-WORK.md](docs/REMAINING-WORK.md) | **What is left and where to start**             |

---

## Before real users

- The **legal templates are drafts**, full of bracketed placeholders, each opening
  with a banner saying they need review. They are a checklist against omission, not
  a legal document.
- **Saudi Arabia's PDPL data-residency question is unresolved.** This app stores
  health data on Supabase infrastructure that is not in the Kingdom. The privacy
  policy flags it with specific questions for a lawyer. It is a real question.
- **Vendor free-tier claims are unverified.** Every limit mentioned comes from the
  original build specification; those pricing pages were unreachable from the build
  environment. Check anything you intend to rely on.

Not a medical device. Everything it produces is computed from what you log.
