# API reference

All paths are prefixed `/api`. Everything except `/auth/register`, `/auth/login` and
`/auth/refresh` requires `Authorization: Bearer <accessToken>`.

Every error response is `{ "error": { "code": string, "message": string } }`, with an
optional `details` map of field errors on a validation failure.

---

## Conventions

**Measurements are metric on the wire.** Weights are kilograms, lengths are
centimetres. Unit preference is a display concern converted at the UI edge only.

**Dates.** `date` fields are plain calendar days, `YYYY-MM-DD`, in the user's local
day. Timestamps are ISO 8601 in UTC.

**`clientId`.** Writes that can be queued offline require one: a client-minted UUID,
8–128 characters of `[A-Za-z0-9_:-]`. It is the idempotency key. Replaying a write
with the same `clientId` returns **200 with the stored resource** and an
`Idempotent-Replay: true` header, rather than 201 or a conflict. The key space is per
user and per resource.

**`foodItemId` is namespaced** by source, so one server-side resolution path serves
all of them: `usda:<fdcId>`, `off:<barcode>`, `custom:<uuid>`, `estimate:<uuid>`,
`manual:`.

**`.strict()` validation.** An unexpected field is a 400, not silently dropped.

---

## Error codes

| Code                      | Status | Means                                                              |
| ------------------------- | ------ | ------------------------------------------------------------------ |
| `VALIDATION_FAILED`       | 400    | Request body, query or params rejected. `details` names the fields |
| `UNAUTHENTICATED`         | 401    | Missing, invalid or expired token                                  |
| `FORBIDDEN`               | 403    | Authenticated but not permitted                                    |
| `NOT_FOUND`               | 404    | No such resource, or not yours                                     |
| `CONFLICT`                | 409    | A genuine conflict — not an idempotent replay                      |
| `PAYLOAD_TOO_LARGE`       | 413    | Upload over the 8 MB limit                                         |
| `UNSUPPORTED_MEDIA_TYPE`  | 415    | Upload was not an allowed image type                               |
| `RATE_LIMITED`            | 429    | Too many requests                                                  |
| `AI_QUOTA_EXHAUSTED`      | 429    | The deployment's daily AI vision allowance is spent                |
| `FOOD_SOURCE_UNAVAILABLE` | 503    | Upstream food database unreachable and not cached                  |
| `AI_UNAVAILABLE`          | 503    | AI provider failed or timed out                                    |
| `CONFIGURATION_ERROR`     | 500    | A required credential is not configured                            |
| `INTERNAL`                | 500    | Unexpected failure                                                 |

A 404 is deliberately returned instead of 403 when a resource belongs to another
user: acknowledging that it exists would confirm someone else's data.

---

## Health

### `GET /api/health` — no auth

```json
{ "status": "ok", "env": "production" }
```

Reports that the process is up, and deliberately nothing about which integrations
are configured. Also the warm-up target for a sleeping free-tier instance.

---

## Auth

### `POST /api/auth/register` — no auth

`{ "email": string, "password": string }` — password minimum 8 characters.

**201** → `{ user: AuthUser, session: AuthSession }`

Also creates the public profile mirror. If the Supabase project requires email
confirmation, returns 401 with a message to confirm first — the caller did nothing
wrong and there is nothing to retry.

Errors: `409 CONFLICT` if the email is taken.

### `POST /api/auth/login` — no auth

`{ "email": string, "password": string }` → **200** `{ user, session }`

A wrong password and an unknown email return an **identical** status and message;
distinguishing them would make this an account-existence oracle.

### `POST /api/auth/refresh` — no auth

`{ "refreshToken": string }` → **200** `{ user, session }`

The client holds the session itself, so supabase-js's auto-refresh never runs.
Without this, every session dies after about an hour. `apiClient` calls it once
automatically on a 401 and replays the original request.

### `POST /api/auth/logout` — **auth required**

**204.** Authenticated, unlike its siblings: it needs to know whose session to end.

---

## Users

### `GET /api/users/me`

**200** → `AuthUser`:

```json
{
  "id": "uuid",
  "email": "a@example.com",
  "units": "metric",
  "goals": { "goal": "cut", "targetCalories": 2200 },
  "preferences": {
    "notifications": { "remindersEnabled": true, "evaluationReadyEnabled": true },
    "ai": { "enabled": true, "photoScanEnabled": true, "evaluationEnabled": true }
  },
  "onboarding": {
    "goalsSubmitted": true,
    "startingStatsSubmitted": true,
    "complete": true
  },
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

`onboarding` is **derived server-side**, not stored: `goalsSubmitted` means
`users.goals` is populated, `startingStatsSubmitted` means at least one
body-composition entry exists. This is what the client reads to decide where to
resume. `complete` is flipped lazily here when both are true.

### `PUT /api/users/me`

Accepts **only** `displayName`, `units`, `goals` and `preferences`. Nested preference
groups may be partial and are merged over stored values.

`id`, `email` and `onboarding` are **server-owned**; sending one is a 400. Accepting
a partial user here would let a client mark its own onboarding complete.

### `POST /api/users/me/onboarding`

`{ "goals": Goals }` → **200** `AuthUser`

Dietary preferences are nested inside `goals`, because step 4 of onboarding has no
endpoint of its own.

---

## Training

### `GET /api/exercises`

Query: `muscleGroup`, `q`. → **200** `Exercise[]`

Global reference data. `mediaUrl` is always a URL string; media is never stored as
binary. A few exercises have no image.

### `GET /api/routines` → `Routine[]`

### `POST /api/routines`

`{ "name": string, "exercises": RoutineExercise[] }` → **201** `Routine`

Every `exerciseId` is checked against the library. The exercises live in a jsonb
column with no foreign key, so without this check a routine could reference an
exercise that never existed and fail later, mid-workout.

### `PUT /api/routines/:id` — partial. → **200** `Routine`

### `DELETE /api/routines/:id` — **204**

Workout history survives: `routine_id` is `ON DELETE SET NULL` and each log keeps its
own `routineName` snapshot.

### `GET /api/workout-logs` → `WorkoutLog[]`

### `POST /api/workout-logs` — offline-syncable

```json
{
  "clientId": "uuid",
  "routineId": "uuid | null",
  "routineName": "Push A",
  "completedAt": "2026-03-01T09:30:00.000Z",
  "durationSeconds": 3600,
  "performed": [
    {
      "exerciseId": "uuid",
      "exerciseName": "Bench Press",
      "sets": [
        { "reps": 8, "weightKg": 80 },
        { "reps": 6, "weightKg": 80 }
      ]
    }
  ]
}
```

**201**, or **200** on replay.

---

## Nutrition

### `GET /api/nutrition/search?q=`

**200** → `{ query, items: FoodItem[], fromCache: boolean, unavailableSources: [] }`

Cache-first. The user's own foods come first, then each enabled external source. A
source that fails is reported in `unavailableSources` rather than failing the whole
search — one outage must not hide the other sources or the user's own foods.

### `GET /api/nutrition/custom-foods` → `CustomFood[]`

### `POST /api/nutrition/custom-foods` — offline-syncable

`{ clientId, name, brand?, servingLabel?, calories, proteinG, carbsG, fatG, fiberG? }`
→ **201**, or **200** on replay.

### `GET /api/nutrition/log?date=YYYY-MM-DD` → `FoodLogEntry[]`

### `POST /api/nutrition/log` — offline-syncable

`{ clientId, foodItemId, date, servingMultiplier, meal? }` → **201** / **200**

**The client does not send macros.** The server resolves the namespaced
`foodItemId` and stores both the per-serving values and the multiplier, with the
resolved totals as generated columns. A client-supplied calorie count is
unverifiable, and `foodName` is snapshotted so past days stay readable after a
custom food is deleted.

### `DELETE /api/nutrition/log/:id` — **204**

### `POST /api/nutrition/scan-photo`

Multipart, field name `photo`. Max 8 MB, `image/*` only. **Synchronous** — takes a
few seconds.

**200** →

```json
{
  "estimate": { "id": "estimate:uuid", "name": "...", "calories": 620, "...": "..." },
  "confidence": "low",
  "detectedItems": ["grilled chicken", "rice"],
  "questions": [
    {
      "id": "cooking-method",
      "question": "How was this cooked?",
      "options": ["Deep fried", "Air fried", "Not sure"]
    }
  ],
  "autoLogged": false
}
```

`servingLabel` describes the **whole portion in the photo** in a unit a person
recognises — "8 pieces", "1 burger", "1 plate" — and "1 portion" when nothing
better can be judged. How much of it was eaten is the log's `servingMultiplier`,
not part of the estimate.

`questions` is at most three, absent or empty when the model had nothing worth
asking or answered in a shape the parser rejected. Every question ends with an
explicit `"Not sure"`, appended server-side whether the model offered it or not:
forcing a guess between air-fried and deep-fried produces worse data than an
honest unknown.

**Nothing is logged.** The estimate is returned for confirmation; logging it is a
separate `POST /nutrition/log` with `foodItemId` set to the returned
`estimate:<uuid>`, which the server re-resolves from its own stored record.

**The image is never persisted** — held in memory for the call and discarded.

Errors: `415` wrong type, `413` too large, `429 AI_QUOTA_EXHAUSTED` when the
deployment's daily allowance is spent, `503 AI_UNAVAILABLE` if the provider cannot
do vision.

### `POST /api/nutrition/scan-photo/refine`

Multipart. Field `photo` is **the same image again**; field `answers` is a JSON
string:

```json
{
  "previousEstimateId": "estimate:uuid",
  "answers": [
    {
      "questionId": "cooking-method",
      "question": "How was this cooked?",
      "option": "Deep fried"
    }
  ],
  "note": "the rice had butter mixed through it"
}
```

**200** → the revised estimate plus `previousCalories`, so the client can show
`1800 → 2520` rather than letting the number change silently. That display is the
only thing telling a user whether answering was worth it. No further questions are
returned: one round, not an interrogation.

Design notes worth knowing before changing this:

- **The image is re-uploaded, not cached between calls.** Telling the model
  "8 pieces" only helps if it can look at the bucket while recalculating, and a
  second look is its one chance to correct something the first pass misread. The
  browser still holds the file, so nothing is stored server-side and the
  never-persisted guarantee is unchanged.
- **`previousEstimateId` is looked up in the caller's own cache**, never trusted
  from the body. Otherwise a client could claim any starting numbers and have the
  model "revise" toward them.
- **The answer carries the question's text**, not just its id. Questions are never
  stored — generated, shown, answered, discarded — and the model reads
  "How was this cooked? → Deep fried" far better than a slug.
- **`option: null` means skipped**, which is not the same as "Not sure" and is
  simply not sent to the model.
- **It counts against the daily vision allowance**, because it is a second real
  call. Two vision calls per scan, so a 1200/day cap is ~600 scans.
- **Bounds are the protection on `note`**: 500 characters, three answers, because
  it is free text going into a prompt.
- **It has its own per-minute rate bucket**, not the scan's. Sharing one made the
  two compete: a scan, a retry, and then answering the questions is three or four
  requests against a limit of five, so the useful half of the flow was refused
  because of the half that had already failed.
- **The revised estimate REPLACES the cached row** under the same id, via an upsert
  on `(kind, source, query)`. A plain insert violates that unique constraint and
  returned a 500 on every refinement until `0002_food_cache_update_policy.sql`
  added the RLS `update` policy the upsert needs. If refinement starts failing
  after a fresh Supabase project, that migration is the first thing to check.

Errors: `404` if the estimate expired or belongs to someone else, `400` for
malformed `answers`, plus the same `415`/`413`/`429`/`503` as the first pass.

---

## Body composition

### `GET /api/body-composition` → `BodyMeasurement[]`

### `POST /api/body-composition/entry` — offline-syncable

`{ clientId, date, weightKg, bodyFatPct?, tapeCm?, notes? }` → **201** / **200**

Several entries per day are allowed. This is also what onboarding's starting stats
become — onboarding has no data model of its own.

### `GET /api/body-composition/trend?days=30`

Window 7–365, default 30. **Deterministic arithmetic, never AI.**

Either:

```json
{
  "status": "ok",
  "days": 28,
  "startWeightKg": 90,
  "endWeightKg": 88,
  "weightChangeKg": -2,
  "ratePerWeekKg": -0.5,
  "direction": "losing",
  "avgDailyCalories": 2000,
  "estimatedMaintenanceCalories": 2550,
  "recommendation": { "action": "hold-calories", "calorieDeltaPerDay": 0, "rationale": "..." }
}
```

or, when there is not enough evidence:

```json
{
  "status": "insufficient-data",
  "reasons": ["not-enough-food-logs"],
  "daysNeeded": 7,
  "weightEntryCount": 12,
  "daysWithFoodLogs": 0
}
```

Refusing is the correct answer below ~14 days, 2 weigh-ins and 7 logged food days —
weight noise swamps the signal and the arithmetic would be confident nonsense.

### `GET /api/body-composition/evaluation`

**200** → `{ status, trend?, summary?, errorCode?, ... }` where status is
`none | pending | ready | failed`.

`trend` is present whenever a row exists, so the UI shows the deterministic numbers
even while the prose is pending or has failed. `summary` only appears on `ready`.

This endpoint is also the reaper: a pending evaluation left stale by a process that
died mid-call is re-fired in the background, bounded by an attempt ceiling. It never
blocks on the AI call.

---

## Overview

### `GET /api/overview?date=YYYY-MM-DD` → `OverviewSummary`

One aggregated response — today's calories against target, macros, next routine,
last workout, the body-composition trend and the evaluation status. The dashboard
reads only this, which is what keeps its numbers mutually consistent.

`date` is optional and is **the caller's** calendar date. It exists because the
server's clock is UTC and a user's day is not: in Riyadh the UTC date is still
yesterday until 03:00, and in New York it is already tomorrow from 19:00, so a
server-derived "today" totalled the wrong day's food for everyone outside UTC.
The client knows its own timezone and says which day it means. Omitting it falls
back to the server's UTC date.

`calories.remaining` may be negative: someone over their target should see by how
much. `pendingSyncCount` is always 0 from the server; the client fills it in from
its own outbox.

---

## Billing

### `GET /api/billing/status`

Always `{ "plan": "free", "isPremium": false }`. No gateway is integrated and the
Premium card takes no money.

### `GET /api/billing/premium-teaser`

Copy for the placeholder card. Nothing is purchasable.

---

## Notifications

### `POST /api/notifications/subscribe`

`{ "oneSignalPlayerId": string }` → **204.** Idempotent, and supports several devices
per account.

> Not yet called by the frontend — see `docs/REMAINING-WORK.md`.
