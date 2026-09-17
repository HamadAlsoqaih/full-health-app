/**
 * Retry for AI provider calls that failed for a reason worth retrying.
 *
 * This exists because of a specific user-visible failure. A photo scan returned
 * 503 with Google's own message: "This model is currently experiencing high
 * demand. Spikes in demand are usually temporary. Please try again later." One
 * busy moment on Google's side put an error in front of someone who had just
 * taken a photo of their lunch, and their only option was to tap Try again.
 *
 * Those spikes last seconds. Retrying twice, a second apart, turns most of them
 * into a successful scan the user never knows about.
 *
 * WHAT IS DELIBERATELY NOT RETRIED matters more than what is. Immediately
 * before that 503, the same endpoint was returning 404 — the configured model
 * had been retired for new API keys. If this helper had retried everything, that
 * 404 would have taken three times as long to surface and looked far more like a
 * flaky network than the hard configuration error it was. Retrying a permanent
 * failure does not fix it; it hides it, wastes the user's time, and spends quota.
 *
 * So: transient means the server said it was temporarily unable, or the
 * connection itself failed. A rejected key, a missing model, a payload the API
 * refuses — those fail once, immediately, with the real reason.
 */
import { logger } from '../../logger.js';

/** Total attempts, including the first. Two retries is enough for a demand spike. */
const DEFAULT_ATTEMPTS = 3;

/**
 * Backoff before each retry, milliseconds.
 *
 * Kept short on purpose: a photo scan is synchronous and the user is watching a
 * spinner. Worst case this adds under three seconds, which is tolerable; a
 * minute of exponential backoff would not be.
 */
const DEFAULT_DELAYS_MS = [700, 1800];

/** HTTP statuses that mean "try again", not "you asked wrong". */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Network-level failures, which carry no HTTP status at all.
 *
 * Matched on message text because these arrive as plain Errors from undici with
 * no stable machine-readable field. A false positive here costs one extra
 * attempt; a false negative costs a retry that would have worked.
 */
const TRANSIENT_MESSAGES = [
  'fetch failed',
  'network',
  'socket hang up',
  'econnreset',
  'econnrefused',
  'etimedout',
  'eai_again',
  'timeout',
  'aborted',
];

/** The status field the Google and Groq SDKs both surface on a failed call. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

export function isTransient(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) {
    // A status was reported, so it decides. A 4xx that is not in the transient
    // set is the caller's problem and will not fix itself.
    return TRANSIENT_STATUSES.has(status);
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return TRANSIENT_MESSAGES.some((needle) => message.includes(needle));
}

export interface RetryOptions {
  /** Named in the log line, so a retry storm is traceable to one call site. */
  label: string;
  attempts?: number;
  delaysMs?: number[];
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Runs `call`, retrying only transient failures.
 *
 * The final error is rethrown unchanged, so the caller's own error handling —
 * and the message the user eventually sees — is unaffected by retrying.
 */
export async function retryTransient<T>(call: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const sleep = options.sleep ?? realSleep;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error;

      const retryable = isTransient(error);
      const remaining = attempts - attempt;

      if (!retryable || remaining === 0) {
        // Logged at warn either way, because both outcomes are worth seeing:
        // a permanent error that was correctly not retried, and a transient one
        // that never recovered.
        logger.warn(
          { err: error, label: options.label, attempt, retryable },
          retryable
            ? 'AI call still failing after retries'
            : 'AI call failed with a permanent error; not retrying',
        );
        throw error;
      }

      const delay = delays[attempt - 1] ?? delays[delays.length - 1] ?? 1000;
      logger.info(
        { label: options.label, attempt, delay, status: statusOf(error) },
        'AI call failed transiently; retrying',
      );
      await sleep(delay);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError;
}
