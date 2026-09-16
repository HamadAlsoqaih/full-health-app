/**
 * The offline outbox.
 *
 * Four writes can happen without a connection — a completed workout, a custom
 * food, a food log entry and a body measurement — because none of them needs an
 * external service. Food *search* is deliberately not among them: USDA and Open
 * Food Facts require a live connection, so there is nothing useful to cache.
 *
 * How it works:
 *
 *  - Each queued write carries a client-minted UUID, which doubles as the server's
 *    idempotency key. A replay therefore returns 200 with the stored row, so a
 *    retried flush can never create a duplicate.
 *  - The queue is flushed **in order** and stops at the first item that fails for
 *    a retryable reason. Order matters: a food-log entry can reference a custom
 *    food created moments earlier in the same offline session, and sending the log
 *    before the food would fail.
 *  - A 4xx other than 408/429 is permanent — a malformed or rejected payload will
 *    never succeed — so the item is dropped rather than retried forever. Anything
 *    else is treated as transient and left in place.
 *
 * IndexedDB is used rather than localStorage because these payloads are
 * structured, can be numerous, and localStorage is synchronous and size-limited.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { OfflineQueueItem, OfflineWriteKind } from '@app/shared-types';

const DB_NAME = 'full-health-offline';
const DB_VERSION = 1;
const STORE = 'outbox';

interface OutboxSchema extends DBSchema {
  [STORE]: {
    key: string;
    value: OfflineQueueItem;
    indexes: { 'by-queued-at': string };
  };
}

/** Where each kind of queued write is sent. */
const ENDPOINTS: Record<OfflineWriteKind, string> = {
  'workout-log': '/api/workout-logs',
  'custom-food': '/api/nutrition/custom-foods',
  'food-log': '/api/nutrition/log',
  'body-measurement': '/api/body-composition/entry',
};

let dbPromise: Promise<IDBPDatabase<OutboxSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<OutboxSchema>> {
  dbPromise ??= openDB<OutboxSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: 'clientId' });
      // Ordered replay depends on this index.
      store.createIndex('by-queued-at', 'queuedAt');
    },
  });
  return dbPromise;
}

export interface QueueOptions {
  /** Injected so tests can drive the queue without a real network. */
  fetchImpl?: typeof globalThis.fetch;
  /** Called after any change, so the UI can show a pending count. */
  onChange?: (pending: number) => void;
}

export async function enqueue(
  kind: OfflineWriteKind,
  clientId: string,
  payload: unknown,
  options: QueueOptions = {},
): Promise<void> {
  const db = await getDb();
  await db.put(STORE, {
    clientId,
    kind,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  options.onChange?.(await pendingCount());
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE);
}

export async function listPending(): Promise<OfflineQueueItem[]> {
  const db = await getDb();
  // By queue time, so the flush preserves the order the user created things in.
  return db.getAllFromIndex(STORE, 'by-queued-at');
}

export async function remove(clientId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, clientId);
}

export async function clear(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

export interface FlushResult {
  sent: number;
  /** Dropped because the server rejected them permanently. */
  dropped: number;
  /** Still queued, either untried or failed transiently. */
  remaining: number;
}

/**
 * A 4xx means the request itself is wrong and resending it will not help, so the
 * item is dropped. 408 and 429 are the exceptions: both explicitly invite a retry.
 */
function isPermanentFailure(status: number): boolean {
  if (status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/**
 * Flushes the outbox in order.
 *
 * Stops at the first transient failure rather than continuing, because later
 * items may depend on earlier ones and because hammering an unreachable server
 * with the whole queue helps nobody.
 */
export async function flush(
  getAccessToken: () => string | null,
  options: QueueOptions = {},
): Promise<FlushResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const result: FlushResult = { sent: 0, dropped: 0, remaining: 0 };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    result.remaining = await pendingCount();
    return result;
  }

  const token = getAccessToken();
  if (!token) {
    // Nothing can be sent unauthenticated; the queue survives until next login.
    result.remaining = await pendingCount();
    return result;
  }

  const items = await listPending();

  for (const item of items) {
    try {
      const response = await fetchImpl(ENDPOINTS[item.kind], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(item.payload),
      });

      // 200 is the replay case and counts as success: the row is already stored,
      // so the item must be dropped rather than retried.
      if (response.ok) {
        await remove(item.clientId);
        result.sent += 1;
        continue;
      }

      if (isPermanentFailure(response.status)) {
        await remove(item.clientId);
        result.dropped += 1;
        continue;
      }

      // Transient: record the attempt and stop, preserving order.
      const db = await getDb();
      await db.put(STORE, {
        ...item,
        attempts: item.attempts + 1,
        lastError: `HTTP ${response.status}`,
      });
      break;
    } catch (error) {
      // A thrown fetch is a network failure, which is transient by definition.
      const db = await getDb();
      await db.put(STORE, {
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : 'network error',
      });
      break;
    }
  }

  result.remaining = await pendingCount();
  options.onChange?.(result.remaining);
  return result;
}

/**
 * Flushes now and whenever connectivity returns.
 *
 * Returns a teardown function. The 'online' event is unreliable on mobile — it
 * can fire while the connection is still unusable, and can fail to fire when a
 * device wakes — so a visibility change is also treated as a trigger.
 */
export function startAutoFlush(
  getAccessToken: () => string | null,
  options: QueueOptions = {},
): () => void {
  let running = false;

  const run = () => {
    if (running) return;
    running = true;
    void flush(getAccessToken, options).finally(() => {
      running = false;
    });
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  run();

  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Test seam: forces the next call to reopen the database. */
export function resetForTests(): void {
  dbPromise = null;
}

export { ENDPOINTS as offlineEndpoints };
