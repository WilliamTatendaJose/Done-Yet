import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAuthClient } from './auth';

const config = { url: 'https://project.supabase.co', anonKey: 'public-anon-key' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Supabase auth adapter', () => {
  it('signs in with the public key and maps the user session', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/auth/v1/token?grant_type=password');
      expect(init?.headers).toMatchObject({ apikey: 'public-anon-key', Authorization: 'Bearer public-anon-key' });
      return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: 'user-1', email: 'person@example.com' } });
    });
    const result = await createSupabaseAuthClient(config, { fetch }).signIn('person@example.com', 'long-enough-password');
    expect(result).toMatchObject({ status: 'success', session: { userId: 'user-1', email: 'person@example.com', accessToken: 'access', refreshToken: 'refresh' } });
  });

  it('accepts email-confirmation signups as pending', async () => {
    const result = await createSupabaseAuthClient(config, { fetch: async () => json({ user: { id: 'user-1' }, session: null }) }).signUp('person@example.com', 'long-enough-password');
    expect(result).toEqual({ status: 'pending', message: 'Account created. Check your email, then sign in.' });
  });

  it('rejects weak credentials before making a request', async () => {
    const fetch = vi.fn();
    const result = await createSupabaseAuthClient(config, { fetch }).signIn('bad-email', 'short');
    expect(result.status).toBe('request-error');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('password reset', () => {
  it('sends the api key and reports the same pending outcome for a real account', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/auth/v1/recover');
      expect(init?.headers).toMatchObject({ apikey: 'public-anon-key', Authorization: 'Bearer public-anon-key' });
      expect(JSON.parse(String(init?.body))).toEqual({ email: 'person@example.com' });
      return json({});
    });
    const result = await createSupabaseAuthClient(config, { fetch }).requestPasswordReset('person@example.com');
    expect(result).toEqual({ status: 'pending', message: 'If that address has an account, a reset link is on its way.' });
  });

  it('reports the identical pending outcome for an address with no account, never confirming or denying it', async () => {
    // Supabase itself answers 200 for an unknown address so the endpoint cannot be used to
    // enumerate registered emails; this asserts the client preserves that non-disclosure.
    const fetch = vi.fn(async () => json({}));
    const result = await createSupabaseAuthClient(config, { fetch }).requestPasswordReset('nobody@example.com');
    expect(result).toEqual({ status: 'pending', message: 'If that address has an account, a reset link is on its way.' });
  });

  it('rejects an invalid email before making a request', async () => {
    const fetch = vi.fn();
    const result = await createSupabaseAuthClient(config, { fetch }).requestPasswordReset('not-an-email');
    expect(result.status).toBe('request-error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces a genuine server failure distinctly from the pending non-disclosure outcome', async () => {
    const fetch = vi.fn(async () => json({ error: 'down' }, 503));
    const result = await createSupabaseAuthClient(config, { fetch }).requestPasswordReset('person@example.com');
    expect(result.status).toBe('server-error');
  });
});

describe('password update', () => {
  it('sends the api key and the access token, not the anon key, as bearer auth', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/auth/v1/user');
      expect(init?.method).toBe('PUT');
      expect(init?.headers).toMatchObject({ apikey: 'public-anon-key', Authorization: 'Bearer user-access-token' });
      expect(JSON.parse(String(init?.body))).toEqual({ password: 'new-long-password' });
      return json({ id: 'user-1' });
    });
    const result = await createSupabaseAuthClient(config, { fetch }).updatePassword('user-access-token', 'new-long-password');
    expect(result).toEqual({ status: 'success' });
  });

  it('enforces the same minimum length as sign-up, before making a request', async () => {
    const fetch = vi.fn();
    const result = await createSupabaseAuthClient(config, { fetch }).updatePassword('user-access-token', 'short');
    expect(result.status).toBe('request-error');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to run without an access token', async () => {
    const fetch = vi.fn();
    const result = await createSupabaseAuthClient(config, { fetch }).updatePassword('', 'new-long-password');
    expect(result.status).toBe('unauthorized');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a rejected password change', async () => {
    const fetch = vi.fn(async () => json({ error: 'weak' }, 400));
    const result = await createSupabaseAuthClient(config, { fetch }).updatePassword('user-access-token', 'new-long-password');
    expect(result.status).toBe('request-error');
  });
});

describe('account deletion', () => {
  it('calls the delete_own_account RPC with the api key and the caller access token', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://project.supabase.co/rest/v1/rpc/delete_own_account');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({ apikey: 'public-anon-key', Authorization: 'Bearer user-access-token' });
      return new Response(null, { status: 204 });
    });
    const result = await createSupabaseAuthClient(config, { fetch }).deleteAccount('user-access-token');
    expect(result).toEqual({ status: 'success' });
  });

  it('treats a 200 with a body as success too', async () => {
    const fetch = vi.fn(async () => json(null, 200));
    const result = await createSupabaseAuthClient(config, { fetch }).deleteAccount('user-access-token');
    expect(result).toEqual({ status: 'success' });
  });

  it('refuses to run without an access token', async () => {
    const fetch = vi.fn();
    const result = await createSupabaseAuthClient(config, { fetch }).deleteAccount('');
    expect(result.status).toBe('unauthorized');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a missing migration distinctly on a 404', async () => {
    const fetch = vi.fn(async () => json({ error: 'not found' }, 404));
    const result = await createSupabaseAuthClient(config, { fetch }).deleteAccount('user-access-token');
    expect(result.status).toBe('request-error');
    if (result.status !== 'success') expect(result.message).toMatch(/migration/);
  });

  it('reports a missing migration distinctly when PostgREST reports PGRST202', async () => {
    const fetch = vi.fn(async () => json({ code: 'PGRST202', message: 'Could not find the function' }, 400));
    const result = await createSupabaseAuthClient(config, { fetch }).deleteAccount('user-access-token');
    expect(result.status).toBe('request-error');
    if (result.status !== 'success') expect(result.message).toMatch(/migration/);
  });

  it('maps an unrelated rejection normally, without claiming the migration is missing', async () => {
    const fetch = vi.fn(async () => json({ error: 'nope' }, 401));
    const result = await createSupabaseAuthClient(config, { fetch }).deleteAccount('user-access-token');
    expect(result.status).toBe('unauthorized');
    if (result.status !== 'success') expect(result.message).not.toMatch(/migration/);
  });
});

describe('supabase gateway api key on account actions', () => {
  // Same regression as runtime.test.ts / attachments.test.ts: the gateway rejects any
  // request lacking `apikey`, even one carrying a valid bearer token, and a mocked fetch
  // cannot reproduce that 401 — so assert the header directly on each new endpoint.
  it('sends the api key on password reset, password update, and account deletion', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => { seen.push({ ...(init?.headers as Record<string, string> | undefined) }); return json({}); });
    const client = createSupabaseAuthClient(config, { fetch });
    await client.requestPasswordReset('person@example.com');
    await client.updatePassword('user-access-token', 'new-long-password');
    await client.deleteAccount('user-access-token');
    expect(seen).toHaveLength(3);
    for (const headers of seen) expect(headers.apikey).toBe('public-anon-key');
  });
});
