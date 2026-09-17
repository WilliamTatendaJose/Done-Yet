import { describe, expect, it } from 'vitest';
import type { CloudStatus } from './runtime';
import { MAX_SYNC_ATTEMPTS, afterFailure, afterSuccess, afterWake, delayMs, isTransient, msUntilDue, noRetry, retryMessage } from './syncRetry';

const now = new Date('2026-09-16T10:00:00.000Z');

describe('isTransient: what is worth trying again', () => {
  it('retries a connection that dropped or a service that is down', () => {
    for (const status of ['timeout', 'network-error', 'server-error'] as CloudStatus[]) {
      expect(isTransient(status)).toBe(true);
    }
  });

  it('retries a conflict, which only reaches it once the merge loop has given up', () => {
    expect(isTransient('conflict')).toBe(true);
  });

  it('does not retry what retrying cannot fix', () => {
    // A rejected token has already had its refresh; the rest are configuration or bugs.
    for (const status of ['unauthorized', 'not-found', 'invalid-response', 'request-error'] as CloudStatus[]) {
      expect(isTransient(status)).toBe(false);
    }
  });
});

describe('delayMs: backoff', () => {
  it('doubles from fifteen seconds', () => {
    expect([1, 2, 3, 4, 5].map(attempts => delayMs(attempts))).toEqual([15_000, 30_000, 60_000, 120_000, 240_000]);
  });

  it('stops growing at ten minutes', () => {
    expect(delayMs(20)).toBe(600_000);
  });

  it('adds up to a quarter of the delay as jitter, so devices do not return in lockstep', () => {
    expect(delayMs(1, 0)).toBe(15_000);
    expect(delayMs(1, 1)).toBe(18_750);
    expect(delayMs(1, 0.5)).toBe(16_875);
  });

  it('ignores a nonsensical jitter rather than producing a nonsensical delay', () => {
    expect(delayMs(1, -5)).toBe(15_000);
    expect(delayMs(1, 99)).toBe(18_750);
  });

  it('lets the server override it, since Retry-After knows something the client does not', () => {
    expect(delayMs(5, 1, 3_000)).toBe(3_000);
    expect(delayMs(1, 0, 0)).toBe(0);
  });

  it('has nothing to wait for before the first failure', () => {
    expect(delayMs(0)).toBe(0);
  });
});

describe('afterFailure: scheduling the next attempt', () => {
  it('schedules the first retry fifteen seconds out', () => {
    const state = afterFailure(noRetry, 'network-error', now);
    expect(state.attempts).toBe(1);
    expect(state.nextAttemptAt).toBe('2026-09-16T10:00:15.000Z');
  });

  it('spaces out repeated failures', () => {
    let state = noRetry;
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      state = afterFailure(state, 'timeout', now);
      delays.push(msUntilDue(state, now)!);
    }
    expect(delays).toEqual([15_000, 30_000, 60_000, 120_000]);
  });

  it('honours a Retry-After the service sent', () => {
    const state = afterFailure(noRetry, 'server-error', now, 0, 90_000);
    expect(msUntilDue(state, now)).toBe(90_000);
  });

  it('stops scheduling once the attempts are spent, leaving it to a wake or a tap', () => {
    let state = noRetry;
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) state = afterFailure(state, 'network-error', now);
    expect(state.attempts).toBe(MAX_SYNC_ATTEMPTS);
    expect(state.nextAttemptAt).toBeNull();
    expect(msUntilDue(state, now)).toBeNull();
  });

  it('schedules nothing for a failure retrying cannot fix, and forgets any backoff', () => {
    const failing = afterFailure(afterFailure(noRetry, 'timeout', now), 'unauthorized', now);
    expect(failing).toEqual(noRetry);
  });
});

describe('recovering', () => {
  it('forgets the backoff on success, so the next hiccup starts short again', () => {
    expect(afterSuccess()).toEqual(noRetry);
  });

  it('forgets the backoff when the app is reopened', () => {
    expect(afterWake()).toEqual(noRetry);
  });
});

describe('msUntilDue', () => {
  it('reads an overdue attempt as due now rather than as a negative wait', () => {
    const state = afterFailure(noRetry, 'timeout', now);
    expect(msUntilDue(state, new Date('2026-09-16T10:05:00.000Z'))).toBe(0);
  });

  it('has nothing to wait for when nothing is scheduled', () => {
    expect(msUntilDue(noRetry, now)).toBeNull();
    expect(msUntilDue({ attempts: 2, nextAttemptAt: 'not a date' }, now)).toBeNull();
  });
});

describe('retryMessage', () => {
  it('says a failure is not final while a retry is pending', () => {
    const state = afterFailure(noRetry, 'network-error', now);
    expect(retryMessage(state, 'Could not reach the service.')).toBe('Could not reach the service. Trying again shortly.');
  });

  it('says what the user can do once it has stopped trying', () => {
    let state = noRetry;
    for (let i = 0; i < MAX_SYNC_ATTEMPTS; i++) state = afterFailure(state, 'network-error', now);
    expect(retryMessage(state, 'Could not reach the service.')).toBe('Could not reach the service. Open the app again or tap Sync to retry.');
  });

  it('leaves a failure that will not be retried speaking for itself', () => {
    expect(retryMessage(noRetry, 'Cloud account authorization was rejected.')).toBe('Cloud account authorization was rejected.');
  });
});
