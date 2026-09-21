/**
 * Read-path resilience.
 *
 * Firestore surfaces a dropped connection or an in-flight channel teardown as an
 * `unavailable` error, even though the same read succeeds moments later. Reads
 * are idempotent, so a bounded retry with a short backoff turns most of those
 * transient failures into slow successes instead of error states the reader has
 * to clear by hand. Writes deliberately do not use this: retrying them could
 * duplicate a mutation that already committed.
 */
import { isOfflineError } from '$lib/data/errors';

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Delay before the first retry; doubled for each subsequent attempt. */
  delayMs?: number;
  /**
   * Upper bound for a single attempt. A stalled channel would otherwise leave a
   * spinner running until the browser gives up, so a read that outlives this is
   * treated as a connection failure and surfaces a retry control instead.
   * Set to 0 to wait indefinitely.
   */
  timeoutMs?: number;
  /** Injectable sleep, so tests do not wait on real timers. */
  wait?: (ms: number) => Promise<void>;
}

export const DEFAULT_READ_TIMEOUT_MS = 8000;

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Timeout failure shape mirroring the Firestore code the UI already understands. */
function readTimeoutError(): Error & { code: string } {
  return Object.assign(new Error('The request timed out.'), { code: 'deadline-exceeded' });
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return operation();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(readTimeoutError()), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Runs `operation`, retrying only while the failure looks like a lost
 * connection. Any other error — a permission problem, a malformed document —
 * propagates immediately, because retrying it would only waste time.
 */
export async function retryRead<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelay = Math.max(0, options.delayMs ?? 250);
  const timeoutMs = options.timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const wait = options.wait ?? defaultWait;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await withTimeout(operation, timeoutMs);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === attempts - 1;
      if (isLastAttempt || !isOfflineError(error)) throw error;
      await wait(baseDelay * 2 ** attempt);
    }
  }

  throw lastError;
}
