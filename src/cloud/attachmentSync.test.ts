import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('../state/database', () => ({
  readMetadata: async (key: string) => store.get(key) ?? null,
  writeMetadata: async (key: string, value: string) => { store.set(key, value); },
}));

import { drainAttachmentQueue, enqueueAttachmentDelete, enqueueAttachmentUpload, failedAttachmentEntries } from './attachmentSync';

const bytes = new TextEncoder().encode('bytes');

beforeEach(() => { store.clear(); });

describe('attachment outbox wiring', () => {
  it('enqueues an upload for a newly added attachment with a local file', async () => {
    await enqueueAttachmentUpload({ id: 'a1', name: 'r.pdf', mimeType: 'application/pdf', size: 1, addedAt: '2026-09-13T00:00:00.000Z', localName: 'a1.pdf', remoteKey: null });
    const raw = store.get('attachment_outbox_v1');
    expect(raw && JSON.parse(raw)).toMatchObject([{ attachmentId: 'a1', op: 'upload', status: 'pending' }]);
  });

  it('does not enqueue an upload for an attachment with no local file', async () => {
    await enqueueAttachmentUpload({ id: 'a1', name: 'r.pdf', mimeType: 'application/pdf', size: 1, addedAt: '2026-09-13T00:00:00.000Z', localName: null, remoteKey: null });
    expect(store.get('attachment_outbox_v1')).toBeUndefined();
  });

  it('does not enqueue a delete for an attachment that was never uploaded', async () => {
    await enqueueAttachmentDelete({ id: 'a1', remoteKey: null });
    expect(store.get('attachment_outbox_v1')).toBeUndefined();
  });

  it('drains a due upload, computing the remoteKey from the owner id and calling back on success', async () => {
    await enqueueAttachmentUpload({ id: 'a1', name: 'r.pdf', mimeType: 'application/pdf', size: 1, addedAt: '2026-09-13T00:00:00.000Z', localName: 'a1.pdf', remoteKey: null });
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    const uploaded: Array<[string, string]> = [];
    await drainAttachmentQueue({
      url: 'https://project.supabase.co', ownerId: 'owner-1', fetch, readLocalFile: async () => bytes,
      onUploaded: async (id, remoteKey) => { uploaded.push([id, remoteKey]); },
    });
    expect(uploaded).toEqual([['a1', 'owner-1/a1.pdf']]);
    expect(JSON.parse(store.get('attachment_outbox_v1')!)).toEqual([]);
  });

  it('backs off and eventually gives up a repeatedly failing upload', async () => {
    await enqueueAttachmentUpload({ id: 'a1', name: 'r.pdf', mimeType: 'application/pdf', size: 1, addedAt: '2026-09-13T00:00:00.000Z', localName: 'a1.pdf', remoteKey: null });
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));
    let now = new Date('2026-09-13T00:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      await drainAttachmentQueue({ url: 'https://project.supabase.co', ownerId: 'owner-1', fetch, readLocalFile: async () => bytes, now, onUploaded: async () => undefined });
      now = new Date(now.getTime() + 60 * 60_000); // past the 1-hour backoff ceiling each time
    }
    const failed = await failedAttachmentEntries();
    expect(failed).toMatchObject([{ attachmentId: 'a1', status: 'failed' }]);
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('gives up immediately on an over-cap (413) upload instead of retrying', async () => {
    await enqueueAttachmentUpload({ id: 'a1', name: 'r.pdf', mimeType: 'application/pdf', size: 1, addedAt: '2026-09-13T00:00:00.000Z', localName: 'a1.pdf', remoteKey: null });
    const fetch = vi.fn(async () => new Response(null, { status: 413 }));
    await drainAttachmentQueue({ url: 'https://project.supabase.co', ownerId: 'owner-1', fetch, readLocalFile: async () => bytes, onUploaded: async () => undefined });
    const failed = await failedAttachmentEntries();
    expect(failed).toMatchObject([{ attachmentId: 'a1', status: 'failed', attempts: 1 }]);
  });

  it('drains a due delete and treats a 404 as success', async () => {
    await enqueueAttachmentDelete({ id: 'a1', remoteKey: 'owner-1/a1.pdf' });
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await drainAttachmentQueue({ url: 'https://project.supabase.co', ownerId: 'owner-1', fetch, onUploaded: async () => undefined });
    expect(JSON.parse(store.get('attachment_outbox_v1')!)).toEqual([]);
  });
});
