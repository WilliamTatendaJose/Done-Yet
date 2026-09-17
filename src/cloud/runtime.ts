/**
 * Small REST sync boundary. It deliberately stores an opaque snapshot: the
 * local domain remains the authority for validating and evolving app state.
 * A server must authenticate and authorize the document URL before accepting
 * either operation.
 */
export type CloudStatus =
  | 'success'
  | 'not-found'
  | 'unauthorized'
  | 'conflict'
  | 'timeout'
  | 'network-error'
  | 'server-error'
  | 'invalid-response'
  | 'request-error';

export interface CloudDocument {
  snapshot: string;
  updatedAt?: string;
}

export type CloudResult<T> =
  | { status: 'success'; value: T; version: string | null; httpStatus: number }
  | {
      status: Exclude<CloudStatus, 'success'>;
      message: string;
      httpStatus?: number;
      /** How long the service asked us to wait, from a `Retry-After` header (429/503). Present only
       * when the server actually said so — the caller's own backoff applies otherwise. Honouring it
       * is what keeps a rate-limited client from making the rate limiting worse. */
      retryAfterMs?: number;
    };

export interface CloudTokenProvider {
  (): string | null | Promise<string | null>;
}

/** The subset of fetch used by the mobile sync protocol, kept easy to mock. */
export type CloudFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudHttpClientOptions {
  /** A complete HTTPS document URL, for example https://api.example.com/v1/state/me. */
  endpoint: string;
  /** Access tokens are resolved at request time and are never persisted by this module. */
  token?: CloudTokenProvider;
  /** Supabase's gateway rejects any request without its publishable/anon key, even one carrying a valid user token. */
  apiKey?: string;
  timeoutMs?: number;
  fetch?: CloudFetch;
  headers?: Record<string, string>;
}

export interface CloudSyncClient {
  pull(): Promise<CloudResult<CloudDocument>>;
  /** Pass the ETag returned by pull to prevent overwriting a concurrent edit. */
  push(snapshot: string, version: string | null): Promise<CloudResult<CloudDocument>>;
}

type HeaderMap = Record<string, string>;
type FetchResult = CloudResult<Response>;

const DEFAULT_TIMEOUT_MS = 15_000;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isValidUrl = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
};
const responseVersion = (response: Response) => response.headers.get('etag') ?? response.headers.get('x-version') ?? null;

export function isCloudSuccess<T>(result: CloudResult<T>): result is Extract<CloudResult<T>, { status: 'success' }> {
  return result.status === 'success';
}

function failure(status: Exclude<CloudStatus, 'success'>, message: string, httpStatus?: number, retryAfterMs?: number): CloudResult<never> {
  return {
    status,
    message,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/** A day is already far past any delay worth holding a sync for, and guards against a header that
 * is absurd or hostile. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

/**
 * `Retry-After` in either form the spec allows: delay-seconds, or an HTTP date. Anything
 * unparseable, negative or absurd is ignored rather than trusted, leaving the caller's own backoff
 * to decide.
 */
export function retryAfterMs(header: string | null, now: Date): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return ms >= 0 && ms <= MAX_RETRY_AFTER_MS ? ms : undefined;
  }
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  const ms = at - now.getTime();
  return ms > 0 && ms <= MAX_RETRY_AFTER_MS ? ms : undefined;
}

function messageFor(response: Response) {
  if (response.status === 429) return 'The cloud service is busy. Try again shortly.';
  if (response.status === 401 || response.status === 403) return 'Cloud account authorization was rejected.';
  if (response.status === 404) return 'No cloud copy exists yet.';
  if (response.status === 409 || response.status === 412) return 'The cloud copy changed on another device.';
  if (response.status >= 500) return 'The cloud service is unavailable. Try again shortly.';
  return `Cloud request failed (${response.status}).`;
}

function statusFor(response: Response): Exclude<CloudStatus, 'success'> {
  if (response.status === 401 || response.status === 403) return 'unauthorized';
  if (response.status === 404) return 'not-found';
  if (response.status === 409 || response.status === 412) return 'conflict';
  if (response.status >= 500 || response.status === 429) return 'server-error';
  return 'request-error';
}

async function request(options: CloudHttpClientOptions, url: string, init: RequestInit): Promise<FetchResult> {
  if (!isValidUrl(url)) return failure('request-error', 'Cloud sync requires a valid HTTP(S) endpoint.');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) return failure('request-error', 'This device does not provide a network client.');
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return failure('request-error', 'Cloud timeout must be between 1 ms and 120 seconds.');
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: HeaderMap = { Accept: 'application/json', ...(options.apiKey?.trim() ? { apikey: options.apiKey.trim() } : {}), ...options.headers, ...(init.headers as HeaderMap | undefined) };
    const token = await options.token?.();
    if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    const response = await fetcher(url, { ...init, headers, signal: controller.signal });
    if (!response.ok) return failure(statusFor(response), messageFor(response), response.status, retryAfterMs(response.headers.get('retry-after'), new Date()));
    return { status: 'success', value: response, version: responseVersion(response), httpStatus: response.status };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return failure('timeout', 'Cloud sync timed out.');
    return failure('network-error', 'Cloud sync could not reach the service. Check your connection.');
  } finally { clearTimeout(timeout); }
}

async function decodeDocument(response: Response): Promise<CloudResult<CloudDocument>> {
  try {
    const body: unknown = await response.json();
    if (!isObject(body) || typeof body.snapshot !== 'string') return failure('invalid-response', 'Cloud service returned an invalid document.', response.status);
    if (body.updatedAt !== undefined && typeof body.updatedAt !== 'string') return failure('invalid-response', 'Cloud service returned an invalid document timestamp.', response.status);
    return { status: 'success', value: { snapshot: body.snapshot, ...(typeof body.updatedAt === 'string' ? { updatedAt: body.updatedAt } : {}) }, version: responseVersion(response), httpStatus: response.status };
  } catch { return failure('invalid-response', 'Cloud service returned invalid JSON.', response.status); }
}

/**
 * Generic document protocol: GET returns { snapshot, updatedAt? }; PUT accepts
 * the same shape. The server should emit ETag. PUT uses If-Match (or
 * If-None-Match: *) so a caller cannot silently overwrite another device.
 */
export function createCloudHttpClient(options: CloudHttpClientOptions): CloudSyncClient {
  return {
    async pull() {
      const result = await request(options, options.endpoint, { method: 'GET' });
      return isCloudSuccess(result) ? decodeDocument(result.value) : result;
    },
    async push(snapshot, version) {
      const result = await request(options, options.endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(version === null ? { 'If-None-Match': '*' } : { 'If-Match': version }) },
        body: JSON.stringify({ snapshot }),
      });
      if (!isCloudSuccess(result)) return result;
      // A successful write may intentionally be empty (204). Retain the local snapshot in that case.
      if (result.value.status === 204) return { status: 'success', value: { snapshot }, version: result.version, httpStatus: result.httpStatus };
      const decoded = await decodeDocument(result.value);
      return isCloudSuccess(decoded) ? { ...decoded, version: decoded.version ?? result.version } : decoded;
    },
  };
}

export interface SupabaseRestClientOptions extends Omit<CloudHttpClientOptions, 'endpoint'> {
  /** Project URL or an already-qualified /rest/v1 URL. */
  url: string;
  table: string;
  documentId: string;
  documentIdColumn?: string;
  snapshotColumn?: string;
  updatedAtColumn?: string;
  /** Monotonic database version used for compare-and-swap updates. */
  versionColumn?: string;
}

function restBase(url: string) { return url.replace(/\/+$/, '').endsWith('/rest/v1') ? url.replace(/\/+$/, '') : `${url.replace(/\/+$/, '')}/rest/v1`; }
function validIdentifier(value: string) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value); }

/** A Supabase/PostgREST adapter; it uses the same ETag CAS semantics as the generic client. */
export function createSupabaseRestClient(options: SupabaseRestClientOptions): CloudSyncClient {
  const idColumn = options.documentIdColumn ?? 'id';
  const snapshotColumn = options.snapshotColumn ?? 'snapshot';
  const updatedAtColumn = options.updatedAtColumn ?? 'updated_at';
  const versionColumn = options.versionColumn ?? 'version';
  const invalid = !isValidUrl(options.url) || ![options.table, idColumn, snapshotColumn, updatedAtColumn, versionColumn].every(validIdentifier) || !options.documentId.trim();
  const versionFromRow = (row: Record<string, unknown>, fallback: string | null) => {
    if (typeof row[versionColumn] === 'number' && Number.isSafeInteger(row[versionColumn])) return `"v${row[versionColumn]}"`;
    if (typeof row[versionColumn] === 'string' && /^\d+$/.test(row[versionColumn])) return `"v${row[versionColumn]}"`;
    return fallback;
  };
  const expectedVersion = (value: string) => {
    const match = value.match(/^"?v?(\d+)"?$/);
    return match ? match[1] : null;
  };
  const endpoint = () => {
    const params = new URLSearchParams({ [idColumn]: `eq.${options.documentId}`, select: `${snapshotColumn},${updatedAtColumn},${versionColumn}` });
    return `${restBase(options.url)}/${encodeURIComponent(options.table)}?${params}`;
  };
  const base: CloudHttpClientOptions = { ...options, endpoint: restBase(options.url) };
  const reject = () => failure('request-error', 'Invalid Supabase REST cloud configuration.') as CloudResult<CloudDocument>;
  return {
    async pull() {
      if (invalid) return reject();
      const result = await request(base, endpoint(), { method: 'GET' });
      if (!isCloudSuccess(result)) return result;
      try {
        const rows: unknown = await result.value.json();
        if (!Array.isArray(rows)) return failure('invalid-response', 'Cloud service returned an invalid document list.', result.httpStatus);
        if (rows.length === 0) return failure('not-found', 'No cloud copy exists yet.', result.httpStatus);
        const row = rows[0];
        if (!isObject(row) || typeof row[snapshotColumn] !== 'string' || (row[updatedAtColumn] !== undefined && typeof row[updatedAtColumn] !== 'string')) return failure('invalid-response', 'Cloud service returned an invalid document.', result.httpStatus);
        return { status: 'success', value: { snapshot: row[snapshotColumn] as string, ...(typeof row[updatedAtColumn] === 'string' ? { updatedAt: row[updatedAtColumn] as string } : {}) }, version: versionFromRow(row, result.version), httpStatus: result.httpStatus };
      } catch { return failure('invalid-response', 'Cloud service returned invalid JSON.', result.httpStatus); }
    },
    async push(snapshot, version) {
      if (invalid) return reject();
      const isCreate = version === null;
      const expected = version === null ? null : expectedVersion(version);
      if (version !== null && expected === null) return failure('conflict', 'The cloud version is invalid. Pull the latest copy and try again.');
      const target = isCreate ? `${restBase(options.url)}/${encodeURIComponent(options.table)}` : `${endpoint()}&${versionColumn}=eq.${expected}`;
      const payload = isCreate ? { [idColumn]: options.documentId, [snapshotColumn]: snapshot } : { [snapshotColumn]: snapshot };
      const result = await request(base, target, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
          ...(isCreate ? { 'If-None-Match': '*' } : { 'If-Match': version }),
        },
        body: JSON.stringify(payload),
      });
      if (!isCloudSuccess(result)) return result;
      // PostgREST represents writes as an array even for one row.
      try {
        const rows: unknown = await result.value.json();
        if (Array.isArray(rows) && rows.length === 0) return failure('conflict', 'The cloud copy changed on another device.', result.httpStatus);
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!isObject(row) || typeof row[snapshotColumn] !== 'string') return failure('invalid-response', 'Cloud service did not return the saved document.', result.httpStatus);
        return { status: 'success', value: { snapshot: row[snapshotColumn] as string, ...(typeof row[updatedAtColumn] === 'string' ? { updatedAt: row[updatedAtColumn] as string } : {}) }, version: versionFromRow(row, result.version), httpStatus: result.httpStatus };
      } catch { return failure('invalid-response', 'Cloud service returned invalid JSON.', result.httpStatus); }
    },
  };
}
