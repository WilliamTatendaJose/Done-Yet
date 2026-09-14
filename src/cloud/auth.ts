import type { CloudStatus } from './runtime';
import type { CloudSession } from './session';
import type { SupabaseConfig } from './config';

type AuthFailure = { status: Exclude<CloudStatus, 'success'>; message: string; httpStatus?: number };

export type AuthResult =
  | { status: 'success'; session: CloudSession }
  | { status: 'pending'; message: string }
  | AuthFailure;

/** Result shape for account actions that do not return a session: a reset request, a password change, or a deletion. */
export type AuthActionResult =
  | { status: 'success' }
  | { status: 'pending'; message: string }
  | AuthFailure;

export interface SupabaseAuthClient {
  signIn(email: string, password: string): Promise<AuthResult>;
  signUp(email: string, password: string): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  /** Always resolves to `pending` with the same message, whether or not the address has an account — see the comment at its call site. */
  requestPasswordReset(email: string): Promise<AuthActionResult>;
  updatePassword(accessToken: string, newPassword: string): Promise<AuthActionResult>;
  /** Deletes the caller's own account via the delete_own_account() RPC (see the 202609130003 migration). Never accepts or sends a user id. */
  deleteAccount(accessToken: string): Promise<AuthActionResult>;
}

interface AuthOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const MIN_PASSWORD_LENGTH = 8;

function failure(message: string, status: Exclude<CloudStatus, 'success'> = 'request-error', httpStatus?: number): AuthFailure {
  return httpStatus === undefined ? { status, message } : { status, message, httpStatus };
}

function mapStatus(status: number): Exclude<CloudStatus, 'success'> {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 408) return 'timeout';
  if (status === 409) return 'conflict';
  if (status >= 500 || status === 429) return 'server-error';
  return 'request-error';
}

function mapMessage(status: number) {
  if (status === 400) return 'Check your email and password.';
  if (status === 401 || status === 403) return 'Those cloud credentials were not accepted.';
  if (status === 429) return 'Too many sign-in attempts. Try again shortly.';
  if (status >= 500) return 'The cloud account service is unavailable. Try again shortly.';
  return `Cloud account request failed (${status}).`;
}

function sessionFrom(body: unknown): CloudSession | null {
  if (!isObject(body) || typeof body.access_token !== 'string' || !body.access_token.trim()) return null;
  const user = isObject(body.user) ? body.user : null;
  const userId = typeof user?.id === 'string' ? user.id : typeof body.user_id === 'string' ? body.user_id : '';
  const email = typeof user?.email === 'string' ? user.email : undefined;
  if (!userId.trim()) return null;
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  const expiresIn = typeof body.expires_in === 'number' && Number.isFinite(body.expires_in) ? body.expires_in : undefined;
  return {
    userId,
    accessToken: body.access_token,
    ...(email ? { email } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresIn !== undefined ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() } : {}),
  };
}

/** Minimal Supabase Auth REST adapter. It avoids shipping a second client runtime into the app. */
export function createSupabaseAuthClient(config: SupabaseConfig, options: AuthOptions = {}): SupabaseAuthClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const request = async (path: string, body: Record<string, unknown>, allowPending = false): Promise<AuthResult> => {
    if (!fetcher) return failure('This device does not provide a network client.', 'request-error');
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return failure('Cloud timeout must be between 1 ms and 120 seconds.');
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${config.url}/auth/v1/${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return failure(mapMessage(response.status), mapStatus(response.status), response.status);
      const parsed: unknown = await response.json();
      const session = sessionFrom(parsed);
      if (!session && allowPending && isObject(parsed) && isObject(parsed.user) && typeof parsed.user.id === 'string') return { status: 'pending', message: 'Account created. Check your email, then sign in.' };
      return session ? { status: 'success', session } : failure('Cloud account returned an invalid session.', 'invalid-response', response.status);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return failure('Cloud sign-in timed out.', 'timeout');
      return failure('Cloud sign-in could not reach the service. Check your connection.', 'network-error');
    } finally { clearTimeout(timeout); }
  };
  const credentials = (email: string, password: string) => {
    if (!validEmail(email) || password.length < MIN_PASSWORD_LENGTH) return failure(`Enter a valid email and a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    return null;
  };
  // Shared plumbing for the account actions below (reset/update/delete): same timeout and
  // abort handling as `request` above, but the caller supplies the method/headers/body and
  // interprets the response itself, since none of these three return a session on success.
  const action = async (url: string, init: RequestInit, onResponse: (response: Response) => Promise<AuthActionResult>): Promise<AuthActionResult> => {
    if (!fetcher) return failure('This device does not provide a network client.', 'request-error');
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return failure('Cloud timeout must be between 1 ms and 120 seconds.');
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { ...init, signal: controller.signal });
      return await onResponse(response);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return failure('Cloud request timed out.', 'timeout');
      return failure('Cloud request could not reach the service. Check your connection.', 'network-error');
    } finally { clearTimeout(timeout); }
  };
  return {
    signIn: async (email, password) => credentials(email, password) ?? request('token?grant_type=password', { email: email.trim(), password }),
    signUp: async (email, password) => credentials(email, password) ?? request('signup', { email: email.trim(), password }, true),
    refresh: async refreshToken => refreshToken.trim() ? request('token?grant_type=refresh_token', { refresh_token: refreshToken }) : failure('Cloud refresh token is missing.', 'invalid-response'),
    requestPasswordReset: async email => {
      if (!validEmail(email)) return failure('Enter a valid email address.');
      return action(`${config.url}/auth/v1/recover`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
        body: JSON.stringify({ email: email.trim() }),
      }, async response => {
        // Supabase answers 200 here whether or not the address has an account — that is
        // deliberate on their part, so this endpoint can never be used to enumerate
        // registered emails. Only a genuine transport/server failure is reported as an
        // error; a real request that reaches the service always resolves to the same
        // "pending" outcome with the same message, unknown address or not.
        if (!response.ok) return failure(mapMessage(response.status), mapStatus(response.status), response.status);
        return { status: 'pending', message: 'If that address has an account, a reset link is on its way.' };
      });
    },
    updatePassword: async (accessToken, newPassword) => {
      if (!accessToken.trim()) return failure('Sign in again to change your password.', 'unauthorized');
      if (newPassword.length < MIN_PASSWORD_LENGTH) return failure(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return action(`${config.url}/auth/v1/user`, {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: config.anonKey, Authorization: `Bearer ${accessToken.trim()}` },
        body: JSON.stringify({ password: newPassword }),
      }, async response => {
        if (!response.ok) return failure(mapMessage(response.status), mapStatus(response.status), response.status);
        return { status: 'success' };
      });
    },
    deleteAccount: async accessToken => {
      if (!accessToken.trim()) return failure('Sign in again to delete your account.', 'unauthorized');
      return action(`${config.url}/rest/v1/rpc/delete_own_account`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', apikey: config.anonKey, Authorization: `Bearer ${accessToken.trim()}` },
        body: '{}',
      }, async response => {
        if (response.ok) return { status: 'success' };
        // PostgREST reports a missing RPC function as either an HTTP 404 or a 400 carrying
        // { code: 'PGRST202' } in the body, depending on version. Either way that means the
        // 202609130003_delete_own_account.sql migration has not been applied yet — a setup
        // problem, not something the user did wrong or can retry their way out of.
        let code: unknown;
        try { const body: unknown = await response.json(); code = isObject(body) ? body.code : undefined; } catch { /* body not JSON; fall through to the generic mapping below */ }
        if (response.status === 404 || code === 'PGRST202') return failure('Account deletion is not set up on this server yet. Ask the app operator to apply the delete_own_account migration.', 'request-error', response.status);
        return failure(mapMessage(response.status), mapStatus(response.status), response.status);
      });
    },
  };
}
