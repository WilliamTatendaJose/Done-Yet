import { describe, expect, it, vi } from 'vitest';
import { createCloudHttpClient, createSupabaseRestClient, isCloudSuccess } from './runtime';

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('cloud REST runtime', () => {
  it('sends a bearer token and returns the server ETag', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token', Accept: 'application/json' });
      return response({ snapshot: '{"version":1}' }, 200, { ETag: '"v1"' });
    });
    const result = await createCloudHttpClient({ endpoint: 'https://api.example.test/state/me', token: async () => 'access-token', fetch }).pull();
    expect(isCloudSuccess(result) && result.version).toBe('"v1"');
  });

  it('uses conditional writes and reports a concurrent update', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'If-Match': '"v1"', 'Content-Type': 'application/json' });
      return response({ error: 'changed' }, 412);
    });
    const result = await createCloudHttpClient({ endpoint: 'https://api.example.test/state/me', fetch }).push('{"version":1}', '"v1"');
    expect(result.status).toBe('conflict');
  });

  it('uses the database version filter for Supabase writes', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('owner_id=eq.user-1');
      expect(url).toContain('version=eq.4');
      expect(init?.method).toBe('PATCH');
      return response([], 200);
    });
    const result = await createSupabaseRestClient({ url: 'https://project.supabase.co', table: 'app_states', documentId: 'user-1', documentIdColumn: 'owner_id', token: () => 'jwt', fetch }).push('{"version":1}', '"v4"');
    expect(result.status).toBe('conflict');
  });

  it('uses create-only writes when a cloud document has no version', async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'If-None-Match': '*' });
      return new Response(null, { status: 204, headers: { ETag: '"v1"' } });
    });
    const result = await createCloudHttpClient({ endpoint: 'https://api.example.test/state/me', fetch }).push('{"version":1}', null);
    expect(result).toMatchObject({ status: 'success', version: '"v1"', value: { snapshot: '{"version":1}' } });
  });

  it('maps timeouts and malformed responses to typed failures', async () => {
    const never = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const timeout = await createCloudHttpClient({ endpoint: 'https://api.example.test/state/me', fetch: never, timeoutMs: 1 }).pull();
    expect(timeout.status).toBe('timeout');
    const invalid = await createCloudHttpClient({ endpoint: 'https://api.example.test/state/me', fetch: async () => response({ nope: true }) }).pull();
    expect(invalid.status).toBe('invalid-response');
  });

  it('adapts a Supabase REST row without baking in credentials', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('https://project.supabase.co/rest/v1/app_states?');
      expect(url).toContain('owner_id=eq.user-1');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer jwt' });
      return response([{ snapshot: '{"version":1}', updated_at: '2026-09-13T10:00:00.000Z' }], 200, { ETag: '"v4"' });
    });
    const result = await createSupabaseRestClient({ url: 'https://project.supabase.co', table: 'app_states', documentId: 'user-1', documentIdColumn: 'owner_id', token: () => 'jwt', fetch }).pull();
    expect(result).toMatchObject({ status: 'success', version: '"v4"', value: { updatedAt: '2026-09-13T10:00:00.000Z' } });
  });
});

describe('supabase gateway api key', () => {
  // Supabase's gateway rejects any request without `apikey`, even one carrying a valid
  // user token ({"message":"No API key found in request"}). Mocked fetch cannot notice
  // that, so assert the header explicitly on every request the sync client makes.
  function recordingFetch() {
    const seen: Array<Record<string, string>> = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      seen.push({ ...(init?.headers as Record<string, string> | undefined) });
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    return { seen, fetcher };
  }

  it('sends the api key alongside the user token on pull', async () => {
    const { seen, fetcher } = recordingFetch();
    const client = createSupabaseRestClient({ url: 'https://project.supabase.co', table: 'app_states', documentId: 'user-1', documentIdColumn: 'owner_id', apiKey: 'publishable-key', token: () => 'user-token', fetch: fetcher });
    await client.pull();
    expect(seen).toHaveLength(1);
    expect(seen[0].apikey).toBe('publishable-key');
    expect(seen[0].Authorization).toBe('Bearer user-token');
  });

  it('sends the api key on push as well', async () => {
    const { seen, fetcher } = recordingFetch();
    const client = createSupabaseRestClient({ url: 'https://project.supabase.co', table: 'app_states', documentId: 'user-1', documentIdColumn: 'owner_id', apiKey: 'publishable-key', token: () => 'user-token', fetch: fetcher });
    await client.push('{}', null);
    expect(seen.every(h => h.apikey === 'publishable-key')).toBe(true);
  });
});
