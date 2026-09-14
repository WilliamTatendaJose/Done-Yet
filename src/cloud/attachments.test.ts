import { describe, expect, it, vi } from 'vitest';
import { createAttachmentsClient, remoteKeyFor } from './attachments';

const response = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const bytes = new TextEncoder().encode('file contents');

describe('remoteKeyFor', () => {
  it('builds {ownerId}/{attachmentId}{ext} with a lowercased, sanitised extension', () => {
    expect(remoteKeyFor('owner-1', { id: 'att-1', name: 'Receipt.PDF' })).toBe('owner-1/att-1.pdf');
  });

  it('drops an unsafe or missing extension rather than propagating it', () => {
    expect(remoteKeyFor('owner-1', { id: 'att-1', name: 'noext' })).toBe('owner-1/att-1');
    expect(remoteKeyFor('owner-1', { id: 'att-1', name: 'evil/../../etc.sh' })).toBe('owner-1/att-1.sh');
    expect(remoteKeyFor('owner-1', { id: 'att-1', name: 'file.tar.gz' })).toBe('owner-1/att-1.gz');
    expect(remoteKeyFor('owner-1', { id: 'att-1', name: 'a.' + 'x'.repeat(20) })).toBe('owner-1/att-1');
  });

  it('never emits a path containing .. or an extra separator', () => {
    const key = remoteKeyFor('owner-1', { id: 'att-1', name: 'x.sh/../../y' })!;
    expect(key.split('/')).toHaveLength(2);
    expect(key).not.toContain('..');
  });

  it('refuses an unsafe owner id or attachment id', () => {
    expect(remoteKeyFor('../owner', { id: 'att-1', name: 'f.pdf' })).toBeNull();
    expect(remoteKeyFor('owner-1', { id: 'a/1', name: 'f.pdf' })).toBeNull();
  });
});

describe('attachments REST client', () => {
  it('uploads with a bearer token, the given content type, and the injected file bytes', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://project.supabase.co/storage/v1/object/attachments/owner-1/att-1.pdf');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', 'Content-Type': 'application/pdf' });
      expect(init?.body).toBe(bytes);
      return response(null, 200);
    });
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', token: () => 'access-token', fetch, readLocalFile: async () => bytes });
    const result = await client.uploadAttachment('a1.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result).toMatchObject({ status: 'success', value: { remoteKey: 'owner-1/att-1.pdf' } });
  });

  it('treats 409 as an idempotent success', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'Duplicate' }), 409));
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, readLocalFile: async () => bytes });
    const result = await client.uploadAttachment('a1.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result).toMatchObject({ status: 'success', value: { remoteKey: 'owner-1/att-1.pdf' } });
  });

  it('reports an over-cap upload as a distinct, actionable failure', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'Payload too large' }), 413));
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, readLocalFile: async () => bytes });
    const result = await client.uploadAttachment('a1.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result.status).not.toBe('success');
    if (result.status !== 'success') {
      expect(result.httpStatus).toBe(413);
      expect(result.message).toMatch(/10 MB/);
    }
  });

  it('maps an unauthorized response', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'no' }), 401));
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, readLocalFile: async () => bytes });
    const result = await client.uploadAttachment('a1.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result.status).toBe('unauthorized');
  });

  it('maps a timeout', async () => {
    const never = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch: never, timeoutMs: 1, readLocalFile: async () => bytes });
    const result = await client.uploadAttachment('a1.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result.status).toBe('timeout');
  });

  it('maps a network error', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, readLocalFile: async () => bytes });
    const result = await client.uploadAttachment('a1.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result.status).toBe('network-error');
  });

  it('fails cleanly when the local file is missing', async () => {
    const fetch = vi.fn();
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, readLocalFile: async () => { throw new Error('missing'); } });
    const result = await client.uploadAttachment('gone.pdf', 'owner-1/att-1.pdf', 'application/pdf');
    expect(result.status).toBe('not-found');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads an object and writes it through the injected file writer', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://project.supabase.co/storage/v1/object/attachments/owner-1/att-1.pdf');
      expect(init?.method).toBe('GET');
      return response(bytes, 200);
    });
    const writeLocalFile = vi.fn(async (written: Uint8Array, remoteKey: string) => { expect(remoteKey).toBe('owner-1/att-1.pdf'); expect(written).toEqual(bytes); return 'new-local-name.pdf'; });
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, writeLocalFile });
    const result = await client.downloadAttachment('owner-1/att-1.pdf');
    expect(result).toMatchObject({ status: 'success', value: { localName: 'new-local-name.pdf' } });
  });

  it('maps a download 404', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'not found' }), 404));
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch, writeLocalFile: async () => 'x' });
    const result = await client.downloadAttachment('owner-1/att-1.pdf');
    expect(result.status).toBe('not-found');
  });

  it('deletes and treats 404 as success (already gone)', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://project.supabase.co/storage/v1/object/attachments/owner-1/att-1.pdf');
      expect(init?.method).toBe('DELETE');
      return response(JSON.stringify({ error: 'not found' }), 404);
    });
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.deleteRemoteAttachment('owner-1/att-1.pdf');
    expect(result).toMatchObject({ status: 'success', value: { remoteKey: 'owner-1/att-1.pdf' } });
  });

  it('reports a real delete failure', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'server' }), 500));
    const client = createAttachmentsClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.deleteRemoteAttachment('owner-1/att-1.pdf');
    expect(result.status).toBe('server-error');
  });
});

describe('supabase gateway api key on storage requests', () => {
  // Supabase's gateway refuses any request without `apikey`, even one carrying a valid user
  // token. Mocked fetch cannot surface that, so assert the header on the storage client too.
  it('sends the api key alongside the user token when uploading', async () => {
    const seen: Array<Record<string, string>> = [];
    const client = createAttachmentsClient({
      url: 'https://project.supabase.co',
      apiKey: 'publishable-key',
      token: () => 'user-token',
      readLocalFile: async () => new Uint8Array([1, 2, 3]),
      fetch: async (_url, init) => { seen.push({ ...(init?.headers as Record<string, string> | undefined) }); return new Response('', { status: 200 }); },
    });
    await client.uploadAttachment('local.txt', 'owner-1/att-1.txt', 'text/plain');
    expect(seen).toHaveLength(1);
    expect(seen[0].apikey).toBe('publishable-key');
    expect(seen[0].Authorization).toBe('Bearer user-token');
  });
});
