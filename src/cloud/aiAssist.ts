/**
 * Supabase Edge Function boundary for cloud AI assistance. Mirrors attachments.ts: an options
 * object with url/apiKey/token/fetch/timeoutMs, a factory returning a client, and the shared
 * CloudResult/CloudStatus vocabulary from runtime.ts rather than a parallel one of its own.
 *
 * The only thing this module ever sends is the `AiPayload` it is handed — never a raw task or
 * project, never a client-built prompt, never more than domain/aiPayload.ts's `buildPayload`
 * produced. The server side (mobile/supabase/functions/ai-assist) re-validates that same shape
 * independently rather than trusting this client, and builds the actual provider prompt itself.
 *
 * The provider behind the function is a reasoning model: even a trivial prompt took ~3s and
 * consumed real "thinking" tokens before any visible answer, so the default timeout here is much
 * more generous than the other cloud clients' 15s.
 */
import type { AiPayload } from '../../../src/domain/aiPayload';
import { isCloudSuccess, type CloudFetch, type CloudResult, type CloudStatus, type CloudTokenProvider } from './runtime';

export interface AiAssistResult { text: string }

export interface AiAssistClient {
  request(payload: AiPayload): Promise<CloudResult<AiAssistResult>>;
}

export interface AiAssistClientOptions {
  /** Project URL, e.g. https://project.supabase.co (or an already-qualified /functions/v1/ai-assist URL). */
  url: string;
  /** Supabase's gateway rejects any request without the publishable/anon key, even one carrying a valid user token. */
  apiKey?: string;
  token?: CloudTokenProvider;
  fetch?: CloudFetch;
  timeoutMs?: number;
}

/** The model took ~3s to answer "Reply with exactly: OK" — leave generous headroom for a real prompt. */
const DEFAULT_TIMEOUT_MS = 60_000;

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function isValidUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
}

function functionUrl(url: string) {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/functions/v1/ai-assist') ? trimmed : `${trimmed}/functions/v1/ai-assist`;
}

function failure(status: Exclude<CloudStatus, 'success'>, message: string, httpStatus?: number): CloudResult<never> {
  return httpStatus === undefined ? { status, message } : { status, message, httpStatus };
}

function statusFor(response: Response): Exclude<CloudStatus, 'success'> {
  if (response.status === 401 || response.status === 403) return 'unauthorized';
  if (response.status === 404) return 'not-found';
  if (response.status >= 500 || response.status === 429) return 'server-error';
  return 'request-error';
}

/** A 400 from the function carries a specific, actionable `{ error }` reason — surface it verbatim rather than a generic message. */
async function messageFor(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) return 'Cloud account authorization was rejected.';
  if (response.status === 404) return 'AI assistance is not available for this build.';
  if (response.status >= 500) return 'The AI assistant is unavailable. Try again shortly.';
  try {
    const body: unknown = await response.clone().json();
    if (isObject(body) && typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  } catch { /* fall through to the generic message below */ }
  return `AI request failed (${response.status}).`;
}

async function request(options: AiAssistClientOptions, init: RequestInit): Promise<CloudResult<Response>> {
  const url = functionUrl(options.url);
  if (!isValidUrl(url)) return failure('request-error', 'AI assistance requires a valid HTTP(S) endpoint.');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) return failure('request-error', 'This device does not provide a network client.');
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return failure('request-error', 'AI request timeout must be between 1 ms and 120 seconds.');
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options.apiKey?.trim() ? { apikey: options.apiKey.trim() } : {}), ...(init.headers as Record<string, string> | undefined) };
    const token = await options.token?.();
    if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    const response = await fetcher(url, { ...init, headers, signal: controller.signal });
    if (!response.ok) return failure(statusFor(response), await messageFor(response), response.status);
    return { status: 'success', value: response, version: null, httpStatus: response.status };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return failure('timeout', 'The AI assistant took too long to respond. Try again.');
    return failure('network-error', 'The AI assistant could not be reached. Check your connection.');
  } finally { clearTimeout(timeout); }
}

/**
 * A Supabase Edge Function adapter for cloud AI assistance. Sends exactly the `AiPayload` it is
 * given as the POST body, alongside the gateway `apikey` header and the caller's bearer token.
 */
export function createAiClient(options: AiAssistClientOptions): AiAssistClient {
  return {
    async request(payload) {
      const result = await request(options, { method: 'POST', body: JSON.stringify(payload) });
      if (!isCloudSuccess(result)) return result;
      let body: unknown;
      try { body = await result.value.json(); }
      catch { return failure('invalid-response', 'The AI assistant returned an invalid response.', result.httpStatus); }
      // A reasoning model can come back HTTP 200 with an empty answer (its whole token budget spent
      // "thinking"); the function is expected to catch that server-side, but this is a second,
      // client-side guard so a null/missing/blank `text` can never surface as a quiet empty success.
      if (!isObject(body) || typeof body.text !== 'string' || !body.text.trim()) {
        return failure('invalid-response', 'The AI assistant did not return an answer. Try again.', result.httpStatus);
      }
      return { status: 'success', value: { text: body.text }, version: null, httpStatus: result.httpStatus };
    },
  };
}
