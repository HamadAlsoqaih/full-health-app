> # TEMPLATE — NOT LEGAL ADVICE, REQUIRES REVIEW BEFORE REAL USERS
>
> This document is a starting point drafted to make sure nothing material was
> forgotten. It is **not** a finished legal document and it is **not** legal advice.
> Have a qualified lawyer review it before this app is offered to any real user.
>
> Saudi Arabia's **Personal Data Protection Law (PDPL)** very likely imposes
> requirements beyond what a generic template covers — in particular around
> health data, lawful basis, and **cross-border transfer and data residency**.
> This app stores personal health data on infrastructure that is **not located in
> Saudi Arabia** (see "Where your data is stored"). That is a specific question to
> put to a lawyer, not something this template resolves.
>
> Every `[BRACKETED]` value below must be filled in before publication.

# Privacy Policy

**Last updated:** `[DATE]`
**Provider:** `[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]`
**Contact for privacy matters:** `[PRIVACY CONTACT EMAIL]`

This policy explains what personal data `[APP NAME]` collects, why, who it is shared
with, where it is stored, and what you can ask us to do with it.

## What we collect

### Health and body data you enter

This is the core of the app, and most of it is health data, which is treated as
sensitive under most data-protection regimes including the PDPL:

- **Body weight** — required, and the one measurement the app cannot work without.
- **Body-fat percentage** — optional.
- **Tape measurements** — optional: neck, chest, waist, hips, thigh, arm, calf.
- **Goals** — whether you are cutting, bulking or maintaining, any target calorie
  and protein figures, and your intended rate of change.
- **Dietary preferences and allergies** — optional, and skippable.
- **Food and meal logs** — what you logged, when, serving sizes and the resulting
  calorie and macronutrient totals.
- **Custom foods** — foods you define yourself, with their macros.
- **Workout logs** — which routine you completed, when, and the sets, repetitions
  and weights you recorded.
- **Meal photographs** — see "Meal photographs" below, which explains that we do
  not keep them.

### Account data

- Email address and an authentication credential (handled by our authentication
  provider — we never store your password ourselves).
- Account creation date, and your unit and notification preferences.

### Technical data

- A device or browser identifier if you enable push notifications (see "Push
  notifications").
- Error and diagnostic reports if something crashes (see "Error monitoring").

We do **not** collect your name unless you choose to set a display name, and we do
not collect your location, contacts, or advertising identifiers.

## Why we collect it

| Purpose                                 | Data used                                                       |
| --------------------------------------- | --------------------------------------------------------------- |
| Provide the core tracking features      | Weight, body fat, tape measurements, food and workout logs      |
| Compute your trend and recommendation   | Weight history and calorie intake                               |
| Estimate calories from a meal photo     | The photograph you submit, for the duration of the request only |
| Authenticate you and keep you signed in | Email, credential, session tokens                               |
| Notify you when something is ready      | Device/browser identifier, notification preferences             |
| Diagnose crashes and errors             | Technical diagnostic data                                       |

We do not sell your personal data, and we do not use it for advertising or
profiling beyond producing the fitness recommendations the app exists to provide.

## Artificial intelligence processing

Two features send your data to a third-party AI provider. **Both can be turned off
in Settings**, and the app remains usable without them.

1. **Meal photo calorie estimation.** When you take or upload a photograph of a
   meal, that image is transmitted to **Google (Gemini API)** for analysis and an
   estimate is returned. The image is sent to Google in order to fulfil your
   request.
2. **Body-composition evaluation phrasing.** A short, non-identifying summary of
   your computed trend (for example weight change over a period and average daily
   calories) is sent to **Google (Gemini API)** and/or **Groq** to be rephrased
   into plain language.

Two things worth being explicit about:

- **The recommendation itself is not produced by AI.** All body-composition
  arithmetic and the resulting advice are computed deterministically by the app.
  The AI provider only rewords an already-final result. Turning the AI features
  off therefore costs you the prose, not the analysis.
- **An AI calorie estimate is never logged automatically.** It is always presented
  to you to confirm or adjust first.

These providers process the data under their own terms and privacy policies, which
we do not control:

- Google Gemini API — `[LINK TO GOOGLE'S APPLICABLE TERMS]`
- Groq — `[LINK TO GROQ'S APPLICABLE TERMS]`

`[CONFIRM with each provider whether inputs may be used for model training on the
plan you are actually on, and state the answer here. Do not assume.]`

## Meal photographs

**We do not retain your meal photographs.** A photo you submit is held in memory
only for as long as the estimate takes, forwarded to the AI provider named above,
and then discarded. It is not written to our database or to file storage, and
there is no photo history feature.

What we do keep is the resulting **estimate** — the food name and macro figures —
so that the entry you confirm remains readable later.

`[If a visual meal history is ever added, this section and the retention section
below must be rewritten, and the lawful basis for storing health-adjacent images
reconsidered.]`

## Where your data is stored

Your account and all logged data are stored using **Supabase** (managed Postgres
and authentication).

**The hosting region is not in Saudi Arabia.** `[STATE THE ACTUAL REGION, e.g.
eu-central-1.]` Your personal and health data is therefore transferred outside the
Kingdom and processed abroad.

This matters legally. The PDPL restricts transferring personal data outside Saudi
Arabia and attaches particular conditions to sensitive data, which health data is.
`[Obtain legal advice on: whether an exemption or approval applies; whether an
adequacy or safeguards mechanism is needed; whether in-Kingdom hosting or a
transfer-impact assessment is required; and what must be disclosed to and consented
to by the user. Record the conclusion here before launch.]`

Subprocessors that may receive personal data:

| Provider            | Purpose                                 | Data received                                |
| ------------------- | --------------------------------------- | -------------------------------------------- |
| Supabase            | Database, authentication, storage       | Account and all logged health data           |
| Google (Gemini API) | Meal photo analysis, summary phrasing   | Meal photos; non-identifying trend summaries |
| Groq                | Summary phrasing (alternative provider) | Non-identifying trend summaries              |
| OneSignal           | Push notification delivery              | Device/browser identifier                    |
| Sentry              | Error monitoring                        | Diagnostic data, see below                   |
| Render              | API hosting                             | Data in transit while a request is served    |
| Cloudflare          | Serving the web app                     | Network-level request data                   |

`[Verify this list against what is actually deployed, and keep it current. Confirm
each provider's own hosting region and sub-processing terms.]`

## Push notifications

If you enable notifications, **OneSignal** receives an identifier for your browser
or device so that a message can be delivered to it. That identifier is stored
against your account so we can notify you — for example when a body-composition
evaluation has finished. No health data is placed in the notification payload.

You can revoke notification permission in your browser or device settings at any
time, and disable it in the app's Settings.

## Error monitoring

We use **Sentry** to receive reports when the app errors. These reports can include
technical context such as the failing operation, a stack trace, browser or device
type, and your user identifier so that a recurring fault can be traced to an
account. `[Confirm and state whether any personal data can appear in error
payloads, and configure scrubbing accordingly.]`

## Food database lookups

When you search for a food, the query is sent to the **USDA FoodData Central** and
**Open Food Facts** services. These searches are cached to reduce repeat lookups.
Search text is not linked to your account in those services' records.

## How long we keep data

- **Logged health data, account data:** kept while your account exists.
- **Meal photographs:** not kept at all (see above).
- **Cached food lookups:** `[RETENTION PERIOD]` — this contains no personal data.
- **Error reports:** as determined by our Sentry retention setting, `[PERIOD]`.

`[Set and state a definite retention period for each row above. "As long as
necessary" is not a sufficient answer under most regimes.]`

## Your rights

You can ask us to:

- **Access** the personal data we hold about you, and receive a copy.
- **Correct** anything inaccurate.
- **Delete your data.** Deleting your account removes your account record and every
  log attached to it — body measurements, food logs, custom foods, workout logs,
  evaluations and push registrations. This is enforced at the database level by
  cascading deletion, not left to application code to remember.
- **Object to or restrict** particular processing, including switching off the AI
  features while continuing to use the app.
- **Withdraw consent** where consent is the basis for processing.

To make any of these requests, contact `[PRIVACY CONTACT EMAIL]`. We will respond
within `[PERIOD — check what the PDPL requires]`.

`[State the lawful basis for each processing purpose, and how the deletion request
route is operated in practice — who receives it and how it is fulfilled.]`

## Children

This app is not intended for anyone under `[AGE]`, and we do not knowingly collect
data from them. `[Check the age threshold applicable in each market, and how it is
enforced at signup.]`

## Security

Access to your data is restricted to your own account. Every user-owned table
enforces this at the database level through row-level security, in addition to
checks in the application. Data is transmitted over TLS.

No system is perfectly secure, and we cannot guarantee absolute security.
`[Describe the breach-notification process and the applicable statutory deadline.]`

## Changes to this policy

If this policy changes materially we will notify you `[HOW]` before the change takes
effect. The "last updated" date above always reflects the current version.

## Contact

`[LEGAL ENTITY NAME]`
`[REGISTERED ADDRESS]`
`[PRIVACY CONTACT EMAIL]`
`[DATA PROTECTION OFFICER, if one is required — check whether the PDPL requires one here]`
