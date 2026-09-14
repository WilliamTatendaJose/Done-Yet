import { describe, expect, it } from 'vitest';
import { backoffMs, dueEntries, enqueue, MAX_ATTEMPTS, recordFailure, recordGiveUp, resolveEntry, withRemoteKey, type AttachmentQueueEntry } from './attachmentQueue';

const upload = (overrides: Partial<AttachmentQueueEntry> = {}): AttachmentQueueEntry => ({
  attachmentId: 'a1', localName: 'a1.pdf', remoteKey: null, mimeType: 'application/pdf', name: 'receipt.pdf',
  op: 'upload', attempts: 0, lastAttemptAt: null, status: 'pending', ...overrides,
});

describe('attachment outbox backoff', () => {
  it('doubles from a 30s base up to a one-hour ceiling', () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(4)).toBe(240_000);
    expect(backoffMs(10)).toBe(60 * 60_000);
  });
});

describe('attachment outbox due entries', () => {
  it('is due immediately on first attempt', () => {
    expect(dueEntries([upload()], new Date('2026-09-13T00:00:00Z'))).toHaveLength(1);
  });

  it('is not due before the backoff window elapses, and due after', () => {
    const entry = upload({ attempts: 1, lastAttemptAt: '2026-09-13T00:00:00.000Z' });
    expect(dueEntries([entry], new Date('2026-09-13T00:00:10.000Z'))).toHaveLength(0);
    expect(dueEntries([entry], new Date('2026-09-13T00:00:30.000Z'))).toHaveLength(1);
  });

  it('never returns a failed entry', () => {
    const entry = upload({ status: 'failed', attempts: MAX_ATTEMPTS, lastAttemptAt: '2020-01-01T00:00:00.000Z' });
    expect(dueEntries([entry], new Date('2030-01-01T00:00:00.000Z'))).toHaveLength(0);
  });

  it('orders least-recently-attempted first, with never-attempted entries first', () => {
    const now = new Date('2026-09-13T01:00:00.000Z');
    const recent = upload({ attachmentId: 'a2', attempts: 1, lastAttemptAt: '2026-09-13T00:59:00.000Z' });
    const older = upload({ attachmentId: 'a3', attempts: 1, lastAttemptAt: '2026-09-13T00:00:00.000Z' });
    const fresh = upload({ attachmentId: 'a1' });
    expect(dueEntries([recent, older, fresh], now).map(e => e.attachmentId)).toEqual(['a1', 'a3', 'a2']);
  });
});

describe('attachment outbox transitions', () => {
  it('enqueue replaces any existing entry for the same attachment id', () => {
    const queue = enqueue([upload()], upload({ op: 'delete', remoteKey: 'owner/a1.pdf', localName: null }));
    expect(queue).toHaveLength(1);
    expect(queue[0].op).toBe('delete');
  });

  it('resolveEntry removes the matching entry only', () => {
    const queue = [upload(), upload({ attachmentId: 'a2' })];
    expect(resolveEntry(queue, 'a1').map(e => e.attachmentId)).toEqual(['a2']);
  });

  it('recordFailure increments attempts and stays pending under the cap', () => {
    const now = new Date('2026-09-13T00:00:00.000Z');
    const queue = recordFailure([upload()], 'a1', now);
    expect(queue[0]).toMatchObject({ attempts: 1, status: 'pending', lastAttemptAt: now.toISOString() });
  });

  it('recordFailure gives up once MAX_ATTEMPTS is reached', () => {
    const now = new Date('2026-09-13T00:00:00.000Z');
    let queue = [upload({ attempts: MAX_ATTEMPTS - 1 })];
    queue = recordFailure(queue, 'a1', now);
    expect(queue[0]).toMatchObject({ attempts: MAX_ATTEMPTS, status: 'failed' });
    // A failed entry is never selected for retry again.
    expect(dueEntries(queue, new Date(now.getTime() + 10 * 60 * 60_000))).toHaveLength(0);
  });

  it('recordGiveUp marks failed on the first attempt, for non-retryable errors like an over-cap upload', () => {
    const now = new Date('2026-09-13T00:00:00.000Z');
    const queue = recordGiveUp([upload()], 'a1', now);
    expect(queue[0]).toMatchObject({ attempts: 1, status: 'failed' });
  });

  it('withRemoteKey fills in the key without resetting attempt state', () => {
    const queue = withRemoteKey([upload({ attempts: 2, lastAttemptAt: '2026-09-13T00:00:00.000Z' })], 'a1', 'owner-1/a1.pdf');
    expect(queue[0]).toMatchObject({ remoteKey: 'owner-1/a1.pdf', attempts: 2 });
  });

  it('leaves other entries untouched', () => {
    const now = new Date('2026-09-13T00:00:00.000Z');
    const queue = recordFailure([upload(), upload({ attachmentId: 'a2' })], 'a1', now);
    expect(queue[1]).toMatchObject({ attachmentId: 'a2', attempts: 0 });
  });
});
