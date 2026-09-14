/**
 * Pure state machine for the attachment outbox. This module owns no I/O: it never touches
 * SQLite, the filesystem, or the network, and it never reads the clock itself — every
 * function takes `now` as an argument. That keeps the retry/backoff/give-up rules
 * deterministic and unit-testable without fake timers or mocked storage.
 *
 * The thin I/O wrapper lives in attachmentSync.ts: it persists this queue via
 * readMetadata/writeMetadata and calls the attachments.ts REST client for the actual
 * network work, then feeds the outcome back through the functions here.
 */

export type AttachmentQueueOp = 'upload' | 'delete';

export interface AttachmentQueueEntry {
  attachmentId: string;
  /** The device file to read for an upload. Unused for a delete. */
  localName: string | null;
  /** Known immediately for a delete. For an upload it starts null and is filled in once an owner id is available (see attachmentSync.ts). */
  remoteKey: string | null;
  /** Content-Type for an upload. Unused for a delete. */
  mimeType: string | null;
  /** The attachment's display name, kept only so a still-unknown remoteKey can be derived safely once an owner id is available. */
  name: string | null;
  op: AttachmentQueueOp;
  attempts: number;
  lastAttemptAt: string | null;
  status: 'pending' | 'failed';
}

export type AttachmentQueue = AttachmentQueueEntry[];

/** After this many failed attempts an entry stops retrying and is surfaced as failed instead. */
export const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

/** Exponential backoff with a one-hour ceiling: 30s, 1m, 2m, 4m, 8m, ... */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempts - 1));
}

function isDue(entry: AttachmentQueueEntry, now: Date): boolean {
  if (entry.status !== 'pending') return false;
  if (entry.attempts === 0 || !entry.lastAttemptAt) return true;
  const last = Date.parse(entry.lastAttemptAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= backoffMs(entry.attempts);
}

/** Entries ready to retry right now, least-recently-attempted first. */
export function dueEntries(queue: AttachmentQueue, now: Date): AttachmentQueueEntry[] {
  const sortKey = (entry: AttachmentQueueEntry) => entry.lastAttemptAt ? Date.parse(entry.lastAttemptAt) : -Infinity;
  return queue.filter(entry => isDue(entry, now)).sort((a, b) => sortKey(a) - sortKey(b));
}

/**
 * Records one intent per attachment: a newer enqueue replaces whatever was pending for
 * that id (for example a delete enqueued for an attachment whose upload never finished).
 */
export function enqueue(queue: AttachmentQueue, entry: AttachmentQueueEntry): AttachmentQueue {
  return [...queue.filter(existing => existing.attachmentId !== entry.attachmentId), entry];
}

/** Drops a resolved entry: the upload or delete succeeded, or the operation is no longer needed. */
export function resolveEntry(queue: AttachmentQueue, attachmentId: string): AttachmentQueue {
  return queue.filter(entry => entry.attachmentId !== attachmentId);
}

/** Records a failed attempt. Past MAX_ATTEMPTS the entry stops retrying and is marked failed. */
export function recordFailure(queue: AttachmentQueue, attachmentId: string, now: Date): AttachmentQueue {
  return queue.map(entry => {
    if (entry.attachmentId !== attachmentId) return entry;
    const attempts = entry.attempts + 1;
    return { ...entry, attempts, lastAttemptAt: now.toISOString(), status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' };
  });
}

/** Records a failure that must never be retried (for example an over-cap upload) — gives up immediately. */
export function recordGiveUp(queue: AttachmentQueue, attachmentId: string, now: Date): AttachmentQueue {
  return queue.map(entry => entry.attachmentId === attachmentId ? { ...entry, attempts: entry.attempts + 1, lastAttemptAt: now.toISOString(), status: 'failed' } : entry);
}

/** Fills in a remoteKey once it becomes known, without disturbing attempt/backoff state. */
export function withRemoteKey(queue: AttachmentQueue, attachmentId: string, remoteKey: string): AttachmentQueue {
  return queue.map(entry => entry.attachmentId === attachmentId ? { ...entry, remoteKey } : entry);
}
