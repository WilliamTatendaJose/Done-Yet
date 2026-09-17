import type { CloudStatus } from './runtime';

/**
 * Pure retry policy for whole-snapshot cloud sync. Like attachmentQueue.ts, this module owns no
 * I/O: it never touches the network, never reads the clock, and never generates its own randomness
 * — `now` and `jitter` are arguments. That keeps "when do we try again" deterministic and testable
 * without fake timers, and leaves useCloudSync.ts as the thin wiring that actually waits.
 *
 * The problem it exists to solve: a sync that failed used to stay failed until the user pressed
 * Sync, because the periodic timer only ran from the synced state. A dropped connection on a train
 * therefore meant no sync until someone noticed.
 */

/**
 * Whether failing with this status is worth trying again on its own, with no user action and
 * nothing else changing.
 *
 * Retried: the connection dropped, the request timed out, the service was down or rate-limiting.
 * Also `conflict` — but only ever reaches here once useCloudSync's own bounded pull/merge/push loop
 * has already given up, which means another device is actively rewriting the document; waiting is
 * then the only thing left that helps.
 *
 * Not retried: `unauthorized` (the session refresh already had its turn — retrying a rejected token
 * just repeats the rejection), `not-found` (a first push creates the document), and
 * `invalid-response` / `request-error`, which are bugs or bad configuration and would fail
 * identically forever.
 */
export function isTransient(status: CloudStatus): boolean {
  return status === 'timeout' || status === 'network-error' || status === 'server-error' || status === 'conflict';
}

export interface SyncRetryState {
  /** Consecutive failed syncs. Reset to zero by any success. */
  attempts: number;
  /** When the next automatic attempt is due, or null when none is scheduled. */
  nextAttemptAt: string | null;
}

export const noRetry: SyncRetryState = { attempts: 0, nextAttemptAt: null };

/**
 * Give up automatic retries after this many consecutive failures — roughly twenty minutes of
 * trying. Past that the device is probably offline for the duration, and a timer waking every ten
 * minutes to fail again only costs battery: the next foreground, or the next tap of Sync, starts
 * over from the first delay.
 */
export const MAX_SYNC_ATTEMPTS = 6;

const BASE_DELAY_MS = 15_000;
const MAX_DELAY_MS = 10 * 60_000;

/**
 * Exponential backoff with a ten-minute ceiling — 15s, 30s, 1m, 2m, 4m, 8m — plus up to a quarter
 * of the delay in jitter, so a service coming back up is not hit by every device that was waiting
 * on it at the same instant. A server's own `Retry-After` wins outright, since it knows something
 * the client does not.
 */
export function delayMs(attempts: number, jitter = 0, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) return retryAfterMs;
  if (attempts <= 0) return 0;
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempts - 1));
  const spread = Math.min(1, Math.max(0, jitter));
  return Math.round(base * (1 + spread * 0.25));
}

/**
 * Records a failure and says when to try again, or gives up (`nextAttemptAt: null`) once the
 * attempts are spent or the failure is not the kind that retrying can fix.
 */
export function afterFailure(state: SyncRetryState, status: CloudStatus, now: Date, jitter = 0, retryAfterMs?: number): SyncRetryState {
  if (!isTransient(status)) return noRetry;
  const attempts = state.attempts + 1;
  if (attempts >= MAX_SYNC_ATTEMPTS) return { attempts, nextAttemptAt: null };
  return { attempts, nextAttemptAt: new Date(now.getTime() + delayMs(attempts, jitter, retryAfterMs)).toISOString() };
}

/** A sync landed: forget the backoff, so the next hiccup starts from the shortest delay again. */
export function afterSuccess(): SyncRetryState {
  return noRetry;
}

/**
 * Coming back to the app is new information — the user has likely just reconnected — so it clears
 * the backoff rather than making them wait out a ten-minute timer they cannot see. The same applies
 * to pressing Sync by hand.
 */
export const afterWake = afterSuccess;

/** Milliseconds until the next attempt, or null when none is scheduled. Never negative: a due or
 * overdue attempt reads as zero, meaning "now". */
export function msUntilDue(state: SyncRetryState, now: Date): number | null {
  if (!state.nextAttemptAt) return null;
  const at = Date.parse(state.nextAttemptAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - now.getTime());
}

/** What to tell the user while a retry is pending, so a failure does not read as final. */
export function retryMessage(state: SyncRetryState, failure: string): string {
  if (state.nextAttemptAt) return `${failure} Trying again shortly.`;
  if (state.attempts >= MAX_SYNC_ATTEMPTS) return `${failure} Open the app again or tap Sync to retry.`;
  return failure;
}
