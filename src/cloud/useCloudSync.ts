import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from '../../../src/state/model';
import type { AppState, Attachment } from '../../../src/domain/types';
import { decodeState } from '../../../src/state/storage';
import { mergeStates } from '../../../src/domain/merge';
import { readMetadata, writeMetadata } from '../state/database';
import { createSupabaseAuthClient, type AuthResult } from './auth';
import { createAttachmentsClient } from './attachments';
import { drainAttachmentQueue, enqueueAttachmentDelete, enqueueAttachmentUpload } from './attachmentSync';
import { getSupabaseConfig } from './config';
import { createSupabaseRestClient, isCloudSuccess, type CloudDocument, type CloudSyncClient } from './runtime';
import { createSecureCloudSessionStore, useCloudSession, type CloudSession } from './session';

export type AttachmentDownloadOutcome = { ok: true; localName: string } | { ok: false; message: string };
export type AccountActionOutcome = { ok: boolean; message: string };

export type CloudSyncStatus = 'disabled' | 'signed-out' | 'syncing' | 'synced' | 'conflict' | 'error';

export interface CloudSyncState {
  configured: boolean;
  status: CloudSyncStatus;
  email: string | null;
  lastSyncedAt: string | null;
  message: string;
  remoteVersion: string | null;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(email: string, password: string): Promise<{ ok: boolean; pendingConfirmation: boolean }>;
  signOut(): Promise<boolean>;
  syncNow(): Promise<boolean>;
  /** Works while signed out. Always resolves `ok: true` with the same non-committal message — see auth.ts's requestPasswordReset. */
  requestPasswordReset(email: string): Promise<AccountActionOutcome>;
  /** Requires a current session; changes the password for the signed-in account. */
  changePassword(newPassword: string): Promise<AccountActionOutcome>;
  /** Deletes the signed-in account server-side (see delete_own_account in the 202609130003 migration), then signs this device out and clears its stored session. Local task/project data on this device is untouched. */
  deleteAccount(): Promise<AccountActionOutcome>;
  /** Persists an outbox entry so a newly-added attachment uploads once signed in, surviving an app kill in the meantime. */
  enqueueAttachmentUpload(attachment: Attachment): Promise<void>;
  /** Persists an outbox entry so removing an attachment locally also removes its cloud copy, avoiding an orphaned object. */
  enqueueAttachmentDelete(attachment: Pick<Attachment, 'id' | 'remoteKey'>): Promise<void>;
  /** On-demand fetch of a remote-only attachment (present on another device, not this one) onto this device. */
  downloadAttachment(attachment: Attachment): Promise<AttachmentDownloadOutcome>;
}

const VERSION_KEY = 'cloud_sync_version';
const LAST_SYNC_KEY = 'cloud_sync_last_at';
const emailFromUserId = (userId: string) => userId.includes('@') ? userId : null;
const emptyWorkspace = (state: AppState) => state.tasks.length === 0 && state.projects.length === 0;
const sameSnapshot = (state: AppState, snapshot: string) => {
  try { return JSON.stringify(state) === JSON.stringify(decodeState(snapshot)); }
  catch { return false; }
};
const isAuthSuccess = (result: AuthResult): result is Extract<AuthResult, { status: 'success' }> => result.status === 'success';

function errorMessage(result: { status: string; message?: string }) {
  return result.message ?? 'Cloud sync could not be completed.';
}

/** Bounds the pull/merge/push retry loop when another writer wins the compare-and-swap in between. */
const MAX_MERGE_ATTEMPTS = 3;

/** Calm, factual one-liner describing what an automatic merge changed. */
function summarizeMerge(tookLocal: number, tookRemote: number) {
  if (!tookLocal && !tookRemote) return 'Synced — this device and the cloud already matched.';
  const parts: string[] = [];
  if (tookLocal) parts.push(`${tookLocal} local`);
  if (tookRemote) parts.push(`${tookRemote} cloud`);
  const total = tookLocal + tookRemote;
  return `Merged — kept ${parts.join(' and ')} change${total === 1 ? '' : 's'}.`;
}

/**
 * Coordinates optional Supabase sync without putting the network on the local
 * write path. Local SQLite remains authoritative while offline; when the
 * cloud copy has diverged, tasks and projects are merged automatically by
 * id (newest `updatedAt` wins, ties keep local) rather than asking the user
 * to pick a whole copy — see domain/merge.ts.
 */
export function useCloudSync(state: AppState | null, dispatch: (action: Action) => Promise<boolean>, replaceRemote: (raw: string) => Promise<boolean>): CloudSyncState {
  const config = useMemo(() => getSupabaseConfig(), []);
  const sessionStore = useMemo(() => createSecureCloudSessionStore(), []);
  const sessionState = useCloudSession(sessionStore);
  const { session, error: sessionError, save: saveSession, clear: clearSession } = sessionState;
  const sessionRef = useRef<CloudSession | null>(null);
  const [status, setStatus] = useState<CloudSyncStatus>(config ? 'signed-out' : 'disabled');
  const [message, setMessage] = useState('');
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const clientRef = useRef<CloudSyncClient | null>(null);
  const auth = useMemo(() => config ? createSupabaseAuthClient(config) : null, [config]);
  const stateRef = useRef<AppState | null>(state);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    sessionRef.current = session;
    if (!config) setStatus('disabled');
    else if (session && status === 'signed-out') setStatus('signed-out');
  }, [config, session, status]);

  useEffect(() => {
    let active = true;
    void readMetadata(LAST_SYNC_KEY).then(value => { if (active && value) setLastSyncedAt(value); }).catch(() => undefined);
    void readMetadata(VERSION_KEY).then(value => { if (active && value) setRemoteVersion(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const clientFor = useCallback((session: CloudSession) => {
    if (!config) return null;
    return createSupabaseRestClient({
      url: config.url,
      table: 'app_states',
      documentId: session.userId,
      documentIdColumn: 'owner_id',
      apiKey: config.anonKey,
      token: sessionStore.token,
    });
  }, [config, sessionStore]);

  const refreshSession = useCallback(async (session: CloudSession) => {
    if (!auth || !session.refreshToken) return null;
    const refreshed = await auth.refresh(session.refreshToken);
    if (!isAuthSuccess(refreshed)) return null;
    const saved = await saveSession(refreshed.session);
    if (saved.status !== 'success') return null;
    sessionRef.current = refreshed.session;
    return refreshed.session;
  }, [auth, saveSession]);

  const saveSyncMarker = useCallback(async (version: string | null) => {
    const now = new Date().toISOString();
    setLastSyncedAt(now);
    await writeMetadata(LAST_SYNC_KEY, now);
    if (version) { setRemoteVersion(version); await writeMetadata(VERSION_KEY, version); }
  }, []);

  /**
   * Merges `localState` with the already-pulled `remoteDoc` (see mergeStates)
   * and applies the result on this device, then pushes it back with the CAS
   * `expectedVersion` from that pull. If another writer won the compare-and-
   * swap in between, re-pull, re-merge against the fresh remote copy and
   * retry — bounded to MAX_MERGE_ATTEMPTS so a hot document cannot loop
   * forever.
   */
  const applyMerge = useCallback(async (localState: AppState, session: CloudSession, remoteDoc: CloudDocument, expectedVersion: string | null, attempt: number): Promise<boolean> => {
    let remoteState: AppState;
    try { remoteState = decodeState(remoteDoc.snapshot); }
    catch { setStatus('error'); setMessage('The cloud copy is invalid. Your device data was not changed.'); return false; }
    const { state: merged, tookLocal, tookRemote } = mergeStates(localState, remoteState, new Date());
    const serialized = JSON.stringify(merged);
    const applied = await replaceRemote(serialized);
    if (!applied) { setStatus('error'); setMessage('The merged copy could not be saved on this device.'); return false; }
    let client = clientRef.current ?? clientFor(session);
    if (!client) return false;
    clientRef.current = client;
    let pushed = await client.push(serialized, expectedVersion);
    if (pushed.status === 'unauthorized' && session.refreshToken && auth) {
      const refreshed = await refreshSession(session);
      if (refreshed) {
        client = clientFor(refreshed);
        if (!client) return false;
        clientRef.current = client;
        pushed = await client.push(serialized, expectedVersion);
      }
    }
    if (pushed.status === 'conflict') {
      if (attempt >= MAX_MERGE_ATTEMPTS) { setStatus('error'); setMessage("Cloud sync couldn't settle after a few tries. Try again shortly."); return false; }
      const rePulled = await client.pull();
      if (!isCloudSuccess(rePulled)) { setStatus('error'); setMessage(errorMessage(rePulled)); return false; }
      return applyMerge(merged, session, rePulled.value, rePulled.version, attempt + 1);
    }
    if (!isCloudSuccess(pushed)) { setStatus('error'); setMessage(errorMessage(pushed)); return false; }
    await saveSyncMarker(pushed.version);
    setStatus('synced');
    setMessage(summarizeMerge(tookLocal, tookRemote));
    return true;
  }, [auth, clientFor, refreshSession, replaceRemote, saveSyncMarker]);

  const syncWith = useCallback(async (local: AppState | null, session: CloudSession): Promise<boolean> => {
    if (!local) return false;
    const client = clientFor(session);
    if (!client) return false;
    clientRef.current = client;
    setStatus('syncing'); setMessage('');
    const pulled = await client.pull();
    if (pulled.status === 'unauthorized' && session.refreshToken && auth) {
      const refreshed = await refreshSession(session);
      if (refreshed) return syncWith(local, refreshed);
    }
    if (pulled.status === 'not-found') {
      let created = await client.push(JSON.stringify(local), null);
      if (created.status === 'unauthorized' && session.refreshToken && auth) {
        const refreshed = await refreshSession(session);
        if (refreshed) return syncWith(local, refreshed);
      }
      if (!isCloudSuccess(created)) { setStatus('error'); setMessage(errorMessage(created)); return false; }
      await saveSyncMarker(created.version);
      setStatus('synced');
      return true;
    }
    if (!isCloudSuccess(pulled)) { setStatus('error'); setMessage(errorMessage(pulled)); return false; }
    try { decodeState(pulled.value.snapshot); }
    catch { setStatus('error'); setMessage('The cloud copy is invalid. Your device data was not changed.'); return false; }
    if (emptyWorkspace(local)) {
      const applied = await replaceRemote(pulled.value.snapshot);
      if (!applied) { setStatus('error'); setMessage('The cloud copy could not be applied. Your device data was not changed.'); return false; }
      await saveSyncMarker(pulled.version); setStatus('synced');
      return true;
    }
    if (sameSnapshot(local, pulled.value.snapshot)) { await saveSyncMarker(pulled.version); setStatus('synced'); return true; }
    return applyMerge(local, session, pulled.value, pulled.version, 1);
  }, [applyMerge, auth, clientFor, refreshSession, replaceRemote, saveSyncMarker]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!config || !auth) { setStatus('disabled'); setMessage('Cloud sync is not configured for this build.'); return false; }
    setStatus('syncing'); setMessage('Signing in…');
    const result = await auth.signIn(email, password);
    if (!isAuthSuccess(result)) { setStatus('error'); setMessage(errorMessage(result)); return false; }
    const saved = await saveSession(result.session);
    if (saved.status !== 'success') { setStatus('error'); setMessage(saved.message); return false; }
    sessionRef.current = result.session;
    return syncWith(state, result.session);
  }, [auth, config, saveSession, state, syncWith]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!config || !auth) { setStatus('disabled'); setMessage('Cloud sync is not configured for this build.'); return { ok: false, pendingConfirmation: false }; }
    setStatus('syncing'); setMessage('Creating account…');
    const result = await auth.signUp(email, password);
    if (result.status === 'pending') { setStatus('signed-out'); setMessage(result.message); return { ok: true, pendingConfirmation: true }; }
    if (!isAuthSuccess(result)) { setStatus('error'); setMessage(errorMessage(result)); return { ok: false, pendingConfirmation: false }; }
    const saved = await saveSession(result.session);
    if (saved.status !== 'success') { setStatus('error'); setMessage(saved.message); return { ok: false, pendingConfirmation: false }; }
    sessionRef.current = result.session;
    await syncWith(state, result.session);
    return { ok: true, pendingConfirmation: false };
  }, [auth, config, saveSession, state, syncWith]);

  const signOut = useCallback(async () => {
    const result = await clearSession();
    if (result.status !== 'success') { setStatus('error'); setMessage(result.message); return false; }
    sessionRef.current = null; clientRef.current = null; setRemoteVersion(null); setStatus(config ? 'signed-out' : 'disabled'); setMessage('');
    return true;
  }, [clearSession, config]);

  // Works whether or not anyone is signed in on this device — the address being reset need
  // not belong to the current session (or any session). auth.ts already returns the same
  // non-committal `pending` outcome whether or not the address has an account.
  const requestPasswordReset = useCallback(async (email: string): Promise<AccountActionOutcome> => {
    if (!auth) return { ok: false, message: 'Cloud sync is not configured for this build.' };
    const result = await auth.requestPasswordReset(email);
    return result.status === 'pending' ? { ok: true, message: result.message } : { ok: false, message: errorMessage(result) };
  }, [auth]);

  const changePassword = useCallback(async (newPassword: string): Promise<AccountActionOutcome> => {
    const current = sessionRef.current;
    if (!auth || !current) return { ok: false, message: 'Sign in to change your password.' };
    const result = await auth.updatePassword(current.accessToken, newPassword);
    return result.status === 'success' ? { ok: true, message: 'Password updated.' } : { ok: false, message: errorMessage(result) };
  }, [auth]);

  // Deletes the account server-side first; only once that has actually succeeded do we tear
  // down the local session, so a failed deletion never leaves the device signed out of an
  // account that still exists.
  const deleteAccount = useCallback(async (): Promise<AccountActionOutcome> => {
    const current = sessionRef.current;
    if (!auth || !current) return { ok: false, message: 'Sign in to delete your account.' };
    // Remove the actual stored bytes first, through the Storage API. Deleting rows from
    // storage.objects (as the SQL function does as a backstop) drops only the metadata —
    // the objects themselves would survive, unreachable and still counted against storage.
    if (config) {
      const storage = createAttachmentsClient({ url: config.url, apiKey: config.anonKey, token: sessionStore.token });
      const remoteKeys = (stateRef.current?.tasks ?? []).flatMap(task => (task.attachments ?? []).map(a => a.remoteKey).filter((k): k is string => !!k));
      for (const remoteKey of remoteKeys) {
        try { await storage.deleteRemoteAttachment(remoteKey); } catch { /* a leftover object must not block account deletion */ }
      }
    }
    const result = await auth.deleteAccount(current.accessToken);
    if (result.status !== 'success') return { ok: false, message: errorMessage(result) };
    await clearSession();
    sessionRef.current = null; clientRef.current = null; setRemoteVersion(null); setStatus(config ? 'signed-out' : 'disabled'); setMessage('');
    return { ok: true, message: 'Your account has been deleted.' };
  }, [auth, clearSession, config, sessionStore]);

  const syncNow = useCallback(() => {
    const session = sessionRef.current;
    if (!config) { setStatus('disabled'); setMessage('Cloud sync is not configured for this build.'); return Promise.resolve(false); }
    if (!session) { setStatus('signed-out'); setMessage('Sign in to sync this device.'); return Promise.resolve(false); }
    return syncWith(state, session);
  }, [config, state, syncWith]);

  useEffect(() => {
    if (!state || !sessionRef.current || status !== 'synced') return;
    const timer = setTimeout(() => { void syncNow(); }, 30_000);
    return () => clearTimeout(timer);
  }, [state, status, syncNow]);

  // Uploads/deletes queued while offline (or before sign-in) are recorded durably in
  // attachmentSync's outbox; this drains it once the account snapshot itself is synced,
  // so it never competes with — or changes the semantics of — the pull/push above.
  const onAttachmentUploaded = useCallback(async (attachmentId: string, remoteKey: string) => {
    const task = stateRef.current?.tasks.find(t => t.attachments?.some(a => a.id === attachmentId));
    if (!task) return;
    await dispatch({ type: 'setAttachmentRemote', id: task.id, attachmentId, remoteKey });
  }, [dispatch]);

  const drainAttachments = useCallback(async (session: CloudSession) => {
    if (!config) return;
    try {
      await drainAttachmentQueue({ url: config.url, apiKey: config.anonKey, token: sessionStore.token, ownerId: session.userId, onUploaded: onAttachmentUploaded });
    } catch { /* best-effort background drain; the next synced tick or enqueue retries */ }
  }, [config, onAttachmentUploaded, sessionStore]);

  useEffect(() => {
    if (status !== 'synced' || !sessionRef.current) return;
    void drainAttachments(sessionRef.current);
  }, [status, drainAttachments]);

  // Draining only on a status transition misses the common case: the queue gains an entry
  // while already synced, so nothing changes and the effect never re-runs. Drain on enqueue too.
  const enqueueUpload = useCallback(async (attachment: Attachment) => {
    if (!config) return;
    await enqueueAttachmentUpload(attachment);
    if (sessionRef.current) void drainAttachments(sessionRef.current);
  }, [config, drainAttachments]);
  const enqueueDelete = useCallback(async (attachment: Pick<Attachment, 'id' | 'remoteKey'>) => {
    if (!config) return;
    await enqueueAttachmentDelete(attachment);
    if (sessionRef.current) void drainAttachments(sessionRef.current);
  }, [config, drainAttachments]);

  const downloadAttachment = useCallback(async (attachment: Attachment): Promise<AttachmentDownloadOutcome> => {
    if (!config) return { ok: false, message: 'Cloud sync is not configured for this build.' };
    if (!sessionRef.current) return { ok: false, message: 'Sign in to download this file.' };
    if (!attachment.remoteKey) return { ok: false, message: 'This attachment has no cloud copy.' };
    const client = createAttachmentsClient({ url: config.url, apiKey: config.anonKey, token: sessionStore.token });
    const result = await client.downloadAttachment(attachment.remoteKey);
    return isCloudSuccess(result) ? { ok: true, localName: result.value.localName } : { ok: false, message: errorMessage(result) };
  }, [config, sessionStore]);

  return {
    configured: !!config,
    status,
    email: session?.email ?? (session?.userId ? emailFromUserId(session.userId) : null),
    lastSyncedAt,
    message: message || sessionError,
    remoteVersion,
    signIn,
    signUp,
    signOut,
    syncNow,
    requestPasswordReset,
    changePassword,
    deleteAccount,
    enqueueAttachmentUpload: enqueueUpload,
    enqueueAttachmentDelete: enqueueDelete,
    downloadAttachment,
  };
}
