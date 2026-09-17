import { describe, expect, it, vi } from 'vitest';
import type { AiPayload } from '../../../src/domain/aiPayload';
import { createAiClient } from './aiAssist';

const response = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const payload: AiPayload = { task: 'progress-parse', fields: { sentence: 'finished the outline, still need refs' } };

describe('ai assist client', () => {
  it('posts the given payload to functions/v1/ai-assist and returns the text on success', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://project.supabase.co/functions/v1/ai-assist');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual(payload);
      return response(JSON.stringify({ text: '60' }), 200);
    });
    const client = createAiClient({ url: 'https://project.supabase.co', token: () => 'access-token', fetch });
    const result = await client.request(payload);
    expect(result).toMatchObject({ status: 'success', value: { text: '60' } });
  });

  it('sends both the apikey header and the bearer token', async () => {
    const seen: Array<Record<string, string>> = [];
    const client = createAiClient({
      url: 'https://project.supabase.co',
      apiKey: 'publishable-key',
      token: () => 'user-token',
      fetch: async (_url, init) => { seen.push({ ...(init?.headers as Record<string, string> | undefined) }); return response(JSON.stringify({ text: 'ok' }), 200); },
    });
    await client.request(payload);
    expect(seen).toHaveLength(1);
    expect(seen[0].apikey).toBe('publishable-key');
    expect(seen[0].Authorization).toBe('Bearer user-token');
  });

  it('maps an unauthorized response', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'no' }), 401));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result.status).toBe('unauthorized');
  });

  it('maps a timeout', async () => {
    const never = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch: never, timeoutMs: 1 });
    const result = await client.request(payload);
    expect(result.status).toBe('timeout');
  });

  it('surfaces a 400 from the function as a specific, actionable message rather than a generic one', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'progress-parse requires exactly sentence.' }), 400));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result.status).toBe('request-error');
    if (result.status !== 'success') expect(result.message).toBe('progress-parse requires exactly sentence.');
  });

  it('treats a null/missing content response as a real error, never an empty success', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ text: null }), 200));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result.status).toBe('invalid-response');
    expect(result.status).not.toBe('success');
  });

  it('treats a response missing the text field the same way', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ usage: {} }), 200));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result.status).toBe('invalid-response');
  });

  it('maps a network error', async () => {
    const fetch = vi.fn(async () => { throw new Error('offline'); });
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result.status).toBe('network-error');
  });

  it('maps a server error', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: 'boom' }), 500));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result.status).toBe('server-error');
  });

  it('surfaces the quota message from a 429 verbatim, so the user sees when they can try again', async () => {
    const fetch = vi.fn(async () => response(JSON.stringify({ error: "You've used today's AI requests. They reset in about 5 hours." }), 429, { 'Retry-After': '18000' }));
    const client = createAiClient({ url: 'https://project.supabase.co', fetch });
    const result = await client.request(payload);
    expect(result).toMatchObject({ status: 'server-error', httpStatus: 429, message: "You've used today's AI requests. They reset in about 5 hours." });
  });
});
