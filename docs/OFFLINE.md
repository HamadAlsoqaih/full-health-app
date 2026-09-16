# Offline behaviour

## Scope

Full offline support is **not** the goal, and could not be: food search needs USDA or
Open Food Facts, which require a live connection, so there is nothing useful to cache
there.

What does work offline are the four writes that depend on nothing external:

| Write                  | Why it matters                                           |
| ---------------------- | -------------------------------------------------------- |
| Completing a workout   | Gym basements have no signal. This is the canonical case |
| Creating a custom food | A recipe typed in a kitchen with no bars                 |
| Logging a food         | The app's most frequent write                            |
| Recording a weigh-in   | Takes five seconds and wants to be frictionless          |

Custom foods are additionally cached in full on the device, because they are few,
entirely user-owned, and needed in order to log a meal without a connection.

Food logging was **added** to the specified list. As specified, a user could create a
custom food offline but not log eating it, which makes the cached-foods feature
half-useless.

---

## How it works

### 1. A client-minted key

Every queued write carries a UUID minted on the device — at **capture** time, not
submit time. That distinction matters for onboarding: if the app dies mid-submit, the
retry carries the same key and cannot create a second measurement.

`mintClientId()` falls back to a timestamp-plus-random string where
`crypto.randomUUID` is unavailable (older Safari, non-secure origins). It is not
cryptographically strong and does not need to be — the value only has to be unique
within one user's own key space.

### 2. The outbox

`frontend/src/shared/lib/offlineQueue.ts` — an IndexedDB store keyed by `clientId`,
indexed by queue time.

IndexedDB rather than localStorage: the payloads are structured, there can be many,
and localStorage is synchronous and size-limited.

A write is queued when `navigator.onLine` is false, or when the request fails with a
transport error or a 5xx. A **4xx is not queued** — the payload is wrong and retrying
would only replay a rejection forever.

### 3. Flushing

```
on 'online'            connectivity returned
on visibilitychange    the app came to the foreground
on mount               catch anything left from last session
```

The `online` event alone is unreliable on mobile: it fires while the connection is
still unusable, and can fail to fire when a device wakes. Visibility is a second,
more dependable trigger.

The flush is **ordered** and **stops at the first transient failure**. Order matters
because a food-log entry can reference a custom food created moments earlier in the
same offline session — sending the log first would fail. Stopping rather than
continuing also avoids hammering an unreachable server with the whole queue.

Outcomes per item:

| Response                | Action           | Why                                                                           |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------- |
| 2xx (including **200**) | Drop from queue  | 200 is the idempotent replay: the row already exists                          |
| 4xx except 408/429      | Drop from queue  | Permanent. Resending will not help, and it must not block the items behind it |
| 408, 429                | Keep, stop flush | Both explicitly invite a retry                                                |
| 5xx                     | Keep, stop flush | Transient                                                                     |
| Thrown fetch            | Keep, stop flush | Network failure by definition                                                 |

There is no session-less flush: without a token nothing can be sent, and the queue
**survives until the next login** rather than being discarded.

### 4. Server-side deduplication

The server dedupes on `(user_id, client_id)`:

1. `idempotency.middleware.ts` looks for an existing row and, if found, returns
   **200 with it** plus an `Idempotent-Replay: true` header.
2. That is only a fast path — read-then-write is not atomic, so two concurrent
   flushes can both miss it. The `unique (user_id, client_id)` constraint rejects the
   loser with Postgres `23505`; `insertIdempotent` catches that, re-reads, and returns
   the same 200.

**The constraint is the correctness guarantee.** The middleware is an optimisation.

Why 200 and not 409: a conflict would make the outbox treat the item as failed and
retry it forever. Why not 201: nothing was created this time. The body is identical to
the original 201, so the client needs no special case.

---

## What the user sees

`SyncIndicator` renders nothing when the queue is empty and the device is online —
which is almost always. Otherwise a sticky bar says either "Offline — N entries saved
on this device" or "Syncing N entries…".

That exists for the case that would otherwise be silent and alarming: someone logged
a workout in a basement, saw it appear, and has no way to tell whether it is safe.

Each write confirms honestly too: "Saved on this device — it will sync when you
reconnect" rather than a bare "Saved".

---

## Conflicts

Last-write-wins by server timestamp, as specified — and currently **vacuous**, which
is worth saying plainly rather than leaving as an apparent gap.

All four tables are append-only with no update path, and the idempotency key already
prevents duplicates. So there is no scenario in which two writes contend for the same
row, and no merge logic was built. `created_at`/`updated_at` exist so that an edit
path added later has something to resolve against.

---

## Known limits

- **Data queued offline lives only on that device.** Clearing site data,
  uninstalling, or losing the phone before it syncs loses it. The terms of service
  say so.
- **No conflict UI**, because there are no conflicts to resolve (see above).
- **No background sync.** The Service Worker's Background Sync API is not used, so
  flushing needs the app to be opened. That is a deliberate omission rather than an
  oversight: Background Sync has patchy support and the app already flushes on
  foreground, which covers the realistic case.
- **No queue size cap.** A user offline for weeks accumulates unbounded entries.
  Unlikely enough to leave alone, but it is not bounded.
