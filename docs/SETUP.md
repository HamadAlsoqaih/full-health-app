# Setup — every external service, and exactly where each value comes from

Nothing in this repository needs a credential to build, typecheck, lint or test.
That is deliberate: `npm ci && npm run lint && npm run build && npm test` passes on a
fresh clone with no `.env` at all. Credentials are only needed to **run** the app
against real services.

Work through this in order. Each step says where to go, which value to copy, and
which environment variable it belongs in.

---

## 0. Prerequisites

- **Node 22** or newer (`node -v`). The CI workflow pins 22.
- **npm 10** or newer.

```bash
git clone https://github.com/HamadAlsoqaih/full-health-app.git
cd full-health-app
npm ci
npm run lint && npm run build && npm test   # should pass with no .env
```

Then create the two env files from their examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

---

## 1. Supabase — database, auth and storage

**Required.** The API will refuse to start without it.

1. Go to <https://supabase.com>, sign in, and create a new project.
   - Pick a **region** and write it down — you need it for the privacy policy, and
     it is the subject of the PDPL question in §6 below.
   - Save the database password somewhere safe; it is shown once.
2. Wait for provisioning (a minute or two).
3. In the dashboard go to **Project Settings → API**. You need three values:

| Dashboard label             | Goes in                     | Which file     |
| --------------------------- | --------------------------- | -------------- |
| Project URL                 | `SUPABASE_URL`              | `backend/.env` |
| `anon` `public` key         | `SUPABASE_ANON_KEY`         | `backend/.env` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` |

> ⚠️ The **service_role** key bypasses row-level security completely. It belongs only
> in the backend environment. Never put it in `frontend/.env`, never commit it, and
> never send it to a browser. In this codebase its use is confined to
> `backend/src/config/supabaseAdmin.ts` and enforced by an eslint rule.

### Apply the schema

The schema, its constraints and all row-level security policies live in
`backend/supabase/migrations/`. Apply them **in filename order**:

| File                                | What it does                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                     | Every table, constraint, index and RLS policy.                                                                                                                                                                               |
| `0002_food_cache_update_policy.sql` | Lets a user replace their own AI photo estimate. Without it, answering the follow-up questions on a photo scan fails with a 500 — the second pass writes the revised estimate under the same id, and RLS refuses the update. |

**If your project was created before `0002` existed**, you already have `0001` and only
need to run `0002`. It is safe to re-run and drops nothing.

**Option A — SQL editor (simplest).** Open **SQL Editor** in the dashboard, paste the
contents of each file in order, and run them.

**Option B — Supabase CLI.**

```bash
npm install -g supabase
supabase link --project-ref <your-project-ref>
supabase db push
```

### Verify it worked

You do not need Supabase to check the schema is sound. With any local Postgres:

```bash
./backend/supabase/verify-migration.sh
```

That applies the migration to a throwaway database and runs 24 assertions over the
constraints and the RLS policies. CI runs it against a Postgres service container.

### Email confirmation

By default Supabase requires a user to confirm their email before a session is
issued. If you want signup to log the user straight in during development, turn it
off under **Authentication → Providers → Email → Confirm email**. The API handles
both cases, but with confirmation on, registration returns a message asking the user
to confirm rather than a session.

---

## 2. Seed the exercise library

**Required for the Training tab to show anything.** Free, no account, no key.

```bash
# Check the parse first — needs no database and no credentials:
npm run seed:exercises --workspace backend -- --dry-run

# Then write to Supabase (uses SUPABASE_SERVICE_ROLE_KEY):
npm run seed:exercises --workspace backend
```

Source: [Free Exercise DB](https://github.com/yuhonas/free-exercise-db) — public
domain, 876 exercises. The script is idempotent on the upstream slug, so re-running
it updates rather than duplicating. Three exercises have no image and fall back to a
placeholder in the UI; that is expected.

Exercise images are referenced as URLs on `raw.githubusercontent.com`. No binary
media is stored in the database or in this repository.

---

## 3. Google Gemini — meal photo scanning and check-in summaries

**Optional.** Without it the app selects a deterministic stub provider: photo
scanning returns an obviously-placeholder estimate and check-in summaries fall back
to the numbers without prose. Everything else, including the whole body-composition
analysis, works normally.

1. Go to <https://aistudio.google.com/apikey>.
2. Create an API key.
3. Put it in `backend/.env`:

```
AI_PROVIDER=gemini
GEMINI_API_KEY=<your key>
```

Check the current free-tier request limits on Google's own pricing page before
relying on them — they change, and this repository does not assert a figure.

`AI_VISION_DAILY_LIMIT` in `backend/.env` caps vision calls for the **whole
deployment** per day. That exists because the upstream quota is account-wide, so
without it one enthusiastic user can exhaust the allowance for everybody.

### Groq (alternative, text only)

```
AI_PROVIDER=groq
GROQ_API_KEY=<from https://console.groq.com/keys>
```

Groq has no vision model wired up here, so photo scanning correctly reports itself
unavailable rather than inventing an estimate. Check-in summaries work.

---

## 4. USDA FoodData Central — food search

**Optional.** Without a key the USDA source is skipped and search falls back to Open
Food Facts, the cache, and the user's own custom foods.

1. Go to <https://fdc.nal.usda.gov/api-key-signup.html>.
2. The key arrives by email.
3. `USDA_FDC_API_KEY=<your key>` in `backend/.env`.

**Open Food Facts needs no key** and is always enabled.

Both are rate-limited per IP, and your API egresses from one IP, so every user
shares one bucket. That is why all lookups are cached first.

---

## 5. Sentry — error tracking

**Optional.** With no DSN, every Sentry call is a no-op.

1. Go to <https://sentry.io>, create an organisation, then **two** projects: one
   **Node** (the API) and one **React** (the web app).
2. For each, **Settings → Client Keys (DSN)** gives you a DSN.

| Value             | Goes in           | Which file      |
| ----------------- | ----------------- | --------------- |
| Node project DSN  | `SENTRY_DSN`      | `backend/.env`  |
| React project DSN | `VITE_SENTRY_DSN` | `frontend/.env` |

The browser DSN is **public by design** — it only permits sending events to that
project. It is safe in a client bundle, and is not the same thing as a Sentry auth
token, which is a secret and is not used here.

Both initialisers strip request bodies before sending. Health data must not be
shipped to a third-party error tracker.

---

## 6. OneSignal — web push notifications

**Optional.** Without it, notifications are silently disabled; nothing else changes.

1. Go to <https://onesignal.com>, create an app, and choose the **Web** platform.
2. Configure it for your site origin.
3. **Settings → Keys & IDs** gives you:

| Value          | Goes in                 | Which file              |
| -------------- | ----------------------- | ----------------------- |
| App ID         | `ONESIGNAL_APP_ID`      | `backend/.env`          |
| App ID (again) | `VITE_ONESIGNAL_APP_ID` | `frontend/.env`         |
| REST API Key   | `ONESIGNAL_API_KEY`     | `backend/.env` **only** |

The App ID is public. The REST API key is a server secret — it must never reach the
browser.

> **Not yet wired:** the frontend does not currently load the OneSignal SDK or call
> `POST /api/notifications/subscribe`. The backend endpoint, the table and the
> dispatch logic all exist and are tested. See `docs/REMAINING-WORK.md`.

---

## 7. Run it locally

```bash
npm run dev
```

That starts the API on `:8080` and the web app on `:5173`. Open
<http://localhost:5173>.

To test mobile behaviour properly, use your browser's device emulation at a phone
size (390×844 is a reasonable iPhone-class default) — the layout, the safe-area
padding and the tap targets are all built for that, not for a desktop window.

---

## 8. Deployment

Neither of these can be scripted from here; both are dashboard steps. CI is a
gate, not a deploy pipeline — Render and Cloudflare Pages each deploy from their own
GitHub integration.

### Backend on Render

1. <https://dashboard.render.com> → **New → Web Service** → connect this repository.
2. Settings:
   - **Root directory:** leave blank (the repo root — it is a workspace build)
   - **Build command:** `npm ci && npm run build --workspace backend`
   - **Start command:** `npm run start --workspace backend`
   - **Health check path:** `/api/health`
3. Add every variable from `backend/.env` under **Environment**.
4. Set `CORS_ORIGINS` to your Cloudflare Pages URL.

> **Do not use Render's own free Postgres** — it expires 30 days after creation.
> Keep using Supabase Postgres, which pauses when idle but does not expire.

Free-tier behaviour to expect: the service sleeps after a period of inactivity, so
the first request after a quiet spell is slow. `/api/health` is a cheap warm-up
target. The filesystem is ephemeral, which is fine — nothing is written to local
disk.

### Frontend on Cloudflare Pages

1. <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages** → connect
   this repository.
2. Settings:
   - **Build command:** `npm ci && npm run build --workspace frontend`
   - **Build output directory:** `frontend/dist`
3. Add `VITE_API_BASE_URL` (your Render URL), `VITE_SENTRY_DSN` and
   `VITE_ONESIGNAL_APP_ID` as build-time variables.

Client-side routing is already handled: `frontend/public/_redirects` sends every
unmatched path to `index.html` with a 200. Without it, Pages answers a reload on
`/app/overview` with its own 404 — a bug that only shows up after deployment,
because the dev server rewrites those paths itself.

`frontend/wrangler.jsonc` is there for the alternative flow, `wrangler deploy`
from `frontend/` as a Worker serving static assets, where
`not_found_handling: "single-page-application"` does the same job. Pick one; both
being present is harmless.

Remember that every `VITE_*` value is **inlined into the public bundle**. Only put
things there that are safe for anyone to read.

---

## 9. Before real users

Not optional, and not something this repository can do for you:

- **Have the legal templates reviewed.** `legal/privacy-policy.md` and
  `legal/terms-of-service.md` are drafts full of `[BRACKETED]` placeholders, each
  starting with a banner saying exactly that.
- **Resolve the PDPL question.** Saudi Arabia's Personal Data Protection Law
  restricts transferring personal data outside the Kingdom, and health data is
  sensitive data. This app stores health data on Supabase infrastructure that is
  **not in Saudi Arabia**. The privacy policy flags it with a list of specific
  questions for a lawyer. It is not resolved.
- **Verify the free-tier claims yourself.** Every vendor limit referred to in this
  repository comes from the original build specification and could not be verified
  from the build environment, which blocks those hosting pages. Check the current
  pricing pages before depending on any of them commercially.
