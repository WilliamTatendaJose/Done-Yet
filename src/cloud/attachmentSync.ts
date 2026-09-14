/**
 * Thin I/O wrapper around the pure attachmentQueue state machine. This is the only
 * place that touches durable storage (readMetadata/writeMetadata — see
 * mobile/src/state/database.ts) or the attachments REST client. It persists progress
 * after every processed entry so an app kill mid-drain never replays finished work and
 * never loses a still-pending one: local SQLite/the outbox row is the durable record,
 * the network call is just what the outbox is trying to make true remotely.
 */
import type { Attachment } from '../../../src/domain/types';
import { readMetadata, writeMetadata } from '../state/database';
import { createAttachmentsClient, remoteKeyFor, type AttachmentsClientOptions } from './attachments';
import { dueEntries, enqueue, recordFailure, recordGiveUp, resolveEntry, withRemoteKey, type AttachmentQueue, type AttachmentQueueEntry } from './attachmentQueue';
import { isCloudSuccess } from './runtime';

const QUEUE_KEY = 'attachment_outbox_v1';

async function loadQueue(): Promise<AttachmentQueue> {
  try {
    const raw = await readMetadata(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AttachmentQueue : [];
  } catch { return []; }
}

async function saveQueue(queue: AttachmentQueue): Promise<void> {
  await writeMetadata(QUEUE_KEY, JSON.stringify(queue));
}

/** Called right after a local save so the outbox survives an app kill before the next drain. */
export async function enqueueAttachmentUpload(attachment: Attachment): Promise<void> {
  if (!attachment.localName) return; // nothing on this device to upload
  const entry: AttachmentQueueEntry = {
    attachmentId: attachment.id, localName: attachment.localName, remoteKey: null,
    mimeType: attachment.mimeType, name: attachment.name, op: 'upload', attempts: 0, lastAttemptAt: null, status: 'pending',
  };
  await saveQueue(enqueue(await loadQueue(), entry));
}

/** Called when an attachment is removed locally, so the bucket does not accumulate an orphaned object. */
export async function enqueueAttachmentDelete(attachment: Pick<Attachment, 'id' | 'remoteKey'>): Promise<void> {
  if (!attachment.remoteKey) return; // never uploaded, nothing to remove remotely
  const entry: AttachmentQueueEntry = {
    attachmentId: attachment.id, localName: null, remoteKey: attachment.remoteKey,
    mimeType: null, name: null, op: 'delete', attempts: 0, lastAttemptAt: null, status: 'pending',
  };
  await saveQueue(enqueue(await loadQueue(), entry));
}

/** For diagnostics/tests: entries that have exhausted their retries. */
export async function failedAttachmentEntries(): Promise<AttachmentQueue> {
  return (await loadQueue()).filter(entry => entry.status === 'failed');
}

export interface DrainAttachmentQueueOptions extends AttachmentsClientOptions {
  /** The signed-in user's id — the owner prefix a remoteKey is built under. */
  ownerId: string;
  now?: Date;
  /** Invoked once a queued upload lands remotely, so the caller can record the remoteKey on the task. */
  onUploaded(attachmentId: string, remoteKey: string): Promise<void>;
}

/**
 * Drains every currently-due entry once. Safe to call repeatedly (from a timer or after
 * sign-in): entries not yet due for retry are left untouched, and a failed give-up entry
 * is never retried again.
 */
export async function drainAttachmentQueue(options: DrainAttachmentQueueOptions): Promise<void> {
  const now = options.now ?? new Date();
  let queue = await loadQueue();
  const client = createAttachmentsClient(options);
  for (const entry of dueEntries(queue, now)) {
    if (entry.op === 'upload') {
      const remoteKey = entry.remoteKey ?? (entry.name ? remoteKeyFor(options.ownerId, { id: entry.attachmentId, name: entry.name }) : null);
      if (!remoteKey || !entry.localName) { queue = recordGiveUp(queue, entry.attachmentId, now); await saveQueue(queue); continue; }
      if (remoteKey !== entry.remoteKey) queue = withRemoteKey(queue, entry.attachmentId, remoteKey);
      const result = await client.uploadAttachment(entry.localName, remoteKey, entry.mimeType ?? 'application/octet-stream');
      if (isCloudSuccess(result)) {
        queue = resolveEntry(queue, entry.attachmentId);
        await options.onUploaded(entry.attachmentId, remoteKey);
      } else if (result.httpStatus === 413) {
        // An over-cap file will never succeed on retry — give up rather than burn attempts on it.
        queue = recordGiveUp(queue, entry.attachmentId, now);
      } else {
        queue = recordFailure(queue, entry.attachmentId, now);
      }
    } else {
      if (!entry.remoteKey) { queue = resolveEntry(queue, entry.attachmentId); await saveQueue(queue); continue; }
      const result = await client.deleteRemoteAttachment(entry.remoteKey);
      queue = isCloudSuccess(result) ? resolveEntry(queue, entry.attachmentId) : recordFailure(queue, entry.attachmentId, now);
    }
    await saveQueue(queue);
  }
}
