/**
 * Supabase Storage REST boundary for task attachments. It follows the same shape as
 * runtime.ts: an options object with endpoint/token/fetch/timeoutMs, a client object
 * returned from a factory, and CloudResult/CloudStatus reused rather than redefined.
 * Access is always as the authenticated user via their access token — never a
 * service-role key — and the server (see the storage.objects RLS policies in the
 * 202609130002 migration) is what actually enforces that a caller can only reach
 * objects under their own uid prefix. This module trusts nothing about that beyond
 * what the HTTP response says.
 *
 * File I/O is injected (readLocalFile/writeLocalFile) rather than imported directly
 * from expo-file-system, so this module — and its tests — never require a real device.
 * The default implementations (used whenever a caller omits them) are the production
 * behaviour and are only touched by on-device code paths.
 */
import type { Attachment } from '../../../src/domain/types';
import { isCloudSuccess, type CloudFetch, type CloudResult, type CloudStatus, type CloudTokenProvider } from './runtime';

export interface AttachmentUploadResult { remoteKey: string }
export interface AttachmentDownloadResult { localName: string }
export interface AttachmentDeleteResult { remoteKey: string }

export interface AttachmentsClient {
  uploadAttachment(localName: string, remoteKey: string, mimeType: string): Promise<CloudResult<AttachmentUploadResult>>;
  downloadAttachment(remoteKey: string): Promise<CloudResult<AttachmentDownloadResult>>;
  deleteRemoteAttachment(remoteKey: string): Promise<CloudResult<AttachmentDeleteResult>>;
}

export interface AttachmentsClientOptions {
  /** Project URL, e.g. https://project.supabase.co (or an already-qualified /storage/v1/object URL). */
  url: string;
  /** Supabase requires its publishable/anon key on every gateway request, even when a user token is present. */
  apiKey?: string;
  token?: CloudTokenProvider;
  fetch?: CloudFetch;
  timeoutMs?: number;
  /** Reads a local attachment's bytes for upload. Defaults to the on-device attachments directory. */
  readLocalFile?: (localName: string) => Promise<Uint8Array>;
  /** Writes downloaded bytes into a new local attachment file and returns its localName. Defaults to the on-device attachments directory. */
  writeLocalFile?: (bytes: Uint8Array, remoteKey: string) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const BUCKET = 'attachments';
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,12}$/;

const isUnsafeSegment = (value: string) => !value || value.includes('/') || value.includes('\\') || value.includes('..');

/**
 * Builds the storage.objects path `{ownerId}/{attachmentId}{ext}`. The extension is
 * derived the same way pickAttachment() sanitises a picked file's extension in
 * mobile/src/features/attachments/storage.ts: only a short alphanumeric suffix is kept,
 * so a hostile file name can never inject a path separator or a `..` segment. Returns
 * null if ownerId or the attachment id itself is unsafe (defense in depth — in practice
 * both come from trusted sources: auth.uid() and randomUUID()).
 */
export function remoteKeyFor(ownerId: string, attachment: Pick<Attachment, 'id' | 'name'>): string | null {
  const owner = ownerId.trim();
  const id = attachment.id.trim();
  if (isUnsafeSegment(owner) || isUnsafeSegment(id)) return null;
  const dot = attachment.name.lastIndexOf('.');
  const raw = dot > 0 ? attachment.name.slice(dot + 1) : '';
  const extension = SAFE_EXTENSION.test(raw) ? `.${raw.toLowerCase()}` : '';
  return `${owner}/${id}${extension}`;
}

function isValidUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; }
  catch { return false; }
}

function storageBase(url: string) {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith(`/storage/v1/object`) ? trimmed : `${trimmed}/storage/v1/object`;
}

/** Percent-encodes each path segment but preserves the single owner-prefix slash. */
function objectUrl(base: string, remoteKey: string) {
  return `${base}/${BUCKET}/${remoteKey.split('/').map(encodeURIComponent).join('/')}`;
}

function failure(status: Exclude<CloudStatus, 'success'>, message: string, httpStatus?: number): CloudResult<never> {
  return httpStatus === undefined ? { status, message } : { status, message, httpStatus };
}

function statusFor(response: Response): Exclude<CloudStatus, 'success'> {
  if (response.status === 401 || response.status === 403) return 'unauthorized';
  if (response.status === 404) return 'not-found';
  if (response.status === 409) return 'conflict';
  if (response.status >= 500 || response.status === 429) return 'server-error';
  return 'request-error';
}

function messageFor(response: Response): string {
  if (response.status === 401 || response.status === 403) return 'Cloud account authorization was rejected.';
  if (response.status === 404) return 'The file was not found in cloud storage.';
  if (response.status === 409) return 'A file already exists at that cloud location.';
  if (response.status === 413) return 'This file is larger than the 10 MB cloud storage limit. Choose a smaller file.';
  if (response.status >= 500) return 'The cloud storage service is unavailable. Try again shortly.';
  return `Cloud storage request failed (${response.status}).`;
}

async function request(options: AttachmentsClientOptions, url: string, init: RequestInit): Promise<CloudResult<Response>> {
  if (!isValidUrl(url)) return failure('request-error', 'Cloud storage requires a valid HTTP(S) endpoint.');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) return failure('request-error', 'This device does not provide a network client.');
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) return failure('request-error', 'Cloud timeout must be between 1 ms and 120 seconds.');
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { ...(options.apiKey?.trim() ? { apikey: options.apiKey.trim() } : {}), ...(init.headers as Record<string, string> | undefined) };
    const token = await options.token?.();
    if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
    const response = await fetcher(url, { ...init, headers, signal: controller.signal });
    if (!response.ok) return failure(statusFor(response), messageFor(response), response.status);
    return { status: 'success', value: response, version: null, httpStatus: response.status };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return failure('timeout', 'Cloud storage request timed out.');
    return failure('network-error', 'Cloud storage could not be reached. Check your connection.');
  } finally { clearTimeout(timeout); }
}

async function defaultReadLocalFile(localName: string): Promise<Uint8Array> {
  const [{ File }, { attachmentsDirectory }] = await Promise.all([import('expo-file-system'), import('../features/attachments/storage')]);
  const file = new File(attachmentsDirectory(), localName);
  if (!file.exists) throw new Error('The attachment file is missing from this device.');
  return file.bytes();
}

async function defaultWriteLocalFile(bytes: Uint8Array, remoteKey: string): Promise<string> {
  const [{ File }, { randomUUID }, { attachmentsDirectory }] = await Promise.all([import('expo-file-system'), import('expo-crypto'), import('../features/attachments/storage')]);
  const dot = remoteKey.lastIndexOf('.');
  const raw = dot > 0 ? remoteKey.slice(dot + 1) : '';
  const extension = SAFE_EXTENSION.test(raw) ? `.${raw}` : '';
  const localName = `${randomUUID()}${extension}`;
  const file = new File(attachmentsDirectory(), localName);
  try { file.write(bytes); }
  catch { file.create(); file.write(bytes); }
  return localName;
}

/** A Supabase Storage adapter, scoped to the private `attachments` bucket. */
export function createAttachmentsClient(options: AttachmentsClientOptions): AttachmentsClient {
  const base = storageBase(options.url);
  const readLocalFile = options.readLocalFile ?? defaultReadLocalFile;
  const writeLocalFile = options.writeLocalFile ?? defaultWriteLocalFile;
  return {
    async uploadAttachment(localName, remoteKey, mimeType) {
      if (isUnsafeSegment(remoteKey.split('/')[0] ?? '') || remoteKey.includes('..')) return failure('request-error', 'Invalid attachment path.');
      let bytes: Uint8Array;
      try { bytes = await readLocalFile(localName); }
      catch { return failure('not-found', 'The attachment file is missing from this device.'); }
      const result = await request(options, objectUrl(base, remoteKey), {
        method: 'POST',
        headers: { 'Content-Type': mimeType || 'application/octet-stream' },
        body: bytes as BodyInit,
      });
      if (isCloudSuccess(result)) return { status: 'success', value: { remoteKey }, version: null, httpStatus: result.httpStatus };
      // A prior attempt may have already landed the object: treat 409 as an idempotent success.
      if (result.httpStatus === 409) return { status: 'success', value: { remoteKey }, version: null, httpStatus: result.httpStatus };
      return result;
    },
    async downloadAttachment(remoteKey) {
      const result = await request(options, objectUrl(base, remoteKey), { method: 'GET' });
      if (!isCloudSuccess(result)) return result;
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await result.value.arrayBuffer()); }
      catch { return failure('invalid-response', 'Cloud storage returned an unreadable file.', result.httpStatus); }
      try {
        const localName = await writeLocalFile(bytes, remoteKey);
        return { status: 'success', value: { localName }, version: null, httpStatus: result.httpStatus };
      } catch { return failure('request-error', 'Could not save the downloaded file on this device.', result.httpStatus); }
    },
    async deleteRemoteAttachment(remoteKey) {
      const result = await request(options, objectUrl(base, remoteKey), { method: 'DELETE' });
      if (isCloudSuccess(result)) return { status: 'success', value: { remoteKey }, version: null, httpStatus: result.httpStatus };
      // Already gone is the goal state for a delete, not a failure.
      if (result.httpStatus === 404) return { status: 'success', value: { remoteKey }, version: null, httpStatus: result.httpStatus };
      return result;
    },
  };
}
