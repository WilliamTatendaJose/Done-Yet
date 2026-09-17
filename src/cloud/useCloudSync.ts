import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as DeviceAppState } from 'react-native';
import type { Action } from '../../../src/state/model';
import type { AppState, Attachment } from '../../../src/domain/types';
import { decodeState } from '../../../src/state/storage';
import { mergeStates } from '../../../src/domain/merge';
import { readMetadata, writeMetadata } from '../state/database';
import { createSupabaseAuthClient, type AuthResult } from './auth';
import { createAttachmentsClient } from './attachments';
import { drainAttachmentQueue, enqueueAttachmentDelete, enqueueAttachmentUpload } from './attachmentSync';
import { getSupabaseConfig } from './config';
import { createSupabaseRestClient, isCloudSuccess, type CloudDocument, type CloudStatus, type CloudSyncClient, type CloudTokenProvider } from './runtime';
import { createSecureCloudSessionStore, useCloudSession, type CloudSession } from './session';
import { afterFailure, afterWake, msUntilDue, noRetry, retryMessage, type SyncRetryState } from './syncRetry';
import { proAccessReason, type ProAccess } from './subscriptionPolicy';

export type { ProAccess } from './subscriptionPolicy';

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
  /** True once a cloud session is loaded and present. The precondition other authenticated cloud
   * features (currently AI assistance, see cloud/useAiAssist.ts) check before ever offering to
   * make a request — the ai-assist Edge Function requires a signed-in caller. */
  signedIn: boolean;
  userId: string | null;
  /** The signed-in user's access token, for other authenticated cloud calls that reuse this same
   * session rather than opening a second one. Resolves at call time; never cached by a consumer. */
  token: CloudTokenProvider;
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

/** A sync outcome that carries enough to decide whether trying again could help. */
type Failure = { status: CloudStatus; message?: string; retryAfterMs?: number };

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
export function useCloudSync(state: AppState | null, dispatch: (action: Action) => Promise<boolean>, replaceRemote: (raw: string) => Promise<boolean>, access: ProAccess = { isPro: true, resolving: false }): CloudSyncState {
  const isPro = access.isPro, entitlementResolving = access.resolving;
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
  const initialSyncUserRef = useRef<string | null>(null);
  // One sync at a time. The initial sync, the periodic tick, a retry and the Sync button can all
  // fire at once; overlapping pull/merge/push cycles would fight each other for the compare-and-swap
  // and turn a healthy sync into a conflict loop. Callers join the run already in flight instead.
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const retryRef = useRef<SyncRetryState>(noRetry);
  const [retry, setRetry] = useState<SyncRetryState>(noRetry);
  const auth = useMemo(() => config ? createSupabaseAuthClient(config) : null, [config]);
  const stateRef = useRef<AppState | null>(state);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    sessionRef.current = session;
    if (!session) initialSyncUserRef.current = null;
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
   * Every way a sync can fail goes through here, so the decision "is this worth trying again on its
   * own" is made in exactly one place (see syncRetry.ts) rather than at a dozen call sites. A
   * failure that retrying cannot fix clears the backoff instead of scheduling one.
   */
  const fail = useCallback((result: Failure, message?: string) => {
    const next = afterFailure(retryRef.current, result.status, new Date(), Math.random(), result.retryAfterMs);
    retryRef.current = next;
    setRetry(next);
    setStatus('error');
    setMessage(retryMessage(next, message ?? errorMessage(result)));
    return false;
  }, []);

  /** Something that failed for a local reason, which no amount of retrying changes. */
  const failLocally = useCallback((message: string) => fail({ status: 'request-error' }, message), [fail]);

  const succeed = useCallback(() => { retryRef.current = noRetry; setRetry(noRetry); }, []);

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
    catch { return failLocally('The cloud copy is invalid. Your device data was not changed.'); }
    const { state: merged, tookLocal, tookRemote } = mergeStates(localState, remoteState, new Date());
    const serialized = JSON.stringify(merged);
    const applied = await replaceRemote(serialized);
    if (!applied) return failLocally('The merged copy could not be saved on this device.');
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
      // The bounded loop above handles contention happening right now; past that, backing off and
      // coming back later is the only thing that helps a document another device keeps rewriting.
      if (attempt >= MAX_MERGE_ATTEMPTS) return fail({ status: 'conflict' }, "Cloud sync couldn't settle after a few tries.");
      const rePulled = await client.pull();
      if (!isCloudSuccess(rePulled)) return fail(rePulled);
      return applyMerge(merged, session, rePulled.value, rePulled.version, attempt + 1);
    }
    if (!isCloudSuccess(pushed)) return fail(pushed);
    await saveSyncMarker(pushed.version);
    succeed();
    setStatus('synced');
    setMessage(summarizeMerge(tookLocal, tookRemote));
    return true;
  }, [auth, clientFor, fail, failLocally, refreshSession, replaceRemote, saveSyncMarker, succeed]);

  /** One pull/merge/push pass. Always call it through `syncWith`, which keeps runs from overlapping. */
  const runSync = useCallback(async (local: AppState | null, session: CloudSession): Promise<boolean> => {
    if (!local) return false;
    const client = clientFor(session);
    if (!client) return false;
    clientRef.current = client;
    setStatus('syncing'); setMessage('');
    const pulled = await client.pull();
    if (pulled.status === 'unauthorized' && session.refreshToken && auth) {
      const refreshed = await refreshSession(session);
      if (refreshed) return runSync(local, refreshed);
    }
    if (pulled.status === 'not-found') {
      let created = await client.push(JSON.stringify(local), null);
      if (created.status === 'unauthorized' && session.refreshToken && auth) {
        const refreshed = await refreshSession(session);
        if (refreshed) return runSync(local, refreshed);
      }
      if (!isCloudSuccess(created)) return fail(created);
      await saveSyncMarker(created.version);
      succeed();
      setStatus('synced');
      return true;
    }
    if (!isCloudSuccess(pulled)) return fail(pulled);
    try { decodeState(pulled.value.snapshot); }
    catch { return failLocally('The cloud copy is invalid. Your device data was not changed.'); }
    if (emptyWorkspace(local)) {
      const applied = await replaceRemote(pulled.value.snapshot);
      if (!applied) return failLocally('The cloud copy could not be applied. Your device data was not changed.');
      await saveSyncMarker(pulled.version); succeed(); setStatus('synced');
      return true;
    }
    if (sameSnapshot(local, pulled.value.snapshot)) { await saveSyncMarker(pulled.version); succeed(); setStatus('synced'); return true; }
    return applyMerge(local, session, pulled.value, pulled.version, 1);
  }, [applyMerge, auth, clientFor, fail, failLocally, refreshSession, replaceRemote, saveSyncMarker, succeed]);

  /**
   * The only entry point to a sync. Concurrent callers join the run already in flight rather than
   * starting a second one: the initial sync, the periodic tick, a scheduled retry and the Sync
   * button can easily coincide, and two pull/merge/push cycles racing each other would lose the
   * compare-and-swap in turn and manufacture the very conflicts the retry exists to survive.
   */
  const syncWith = useCallback((local: AppState | null, session: CloudSession): Promise<boolean> => {
    const running = inFlightRef.current;
    if (running) return running;
    const run = runSync(local, session).finally(() => { inFlightRef.current = null; });
    inFlightRef.current = run;
    return run;
  }, [runSync]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!config || !auth) { setStatus('disabled'); setMessage('Cloud sync is not configured for this build.'); return false; }
    setStatus('syncing'); setMessage('Signing in…');
    const result = await auth.signIn(email, password);
    if (!isAuthSuccess(result)) { setStatus('error'); setMessage(errorMessage(result)); return false; }
    const saved = await saveSession(result.session);
    if (saved.status !== 'success') { setStatus('error'); setMessage(saved.message); return false; }
    sessionRef.current = result.session;
    setStatus('signed-out');
    setMessage('Signed in. Checking Done Yet? Pro access…');
    return true;
  }, [auth, config, saveSession]);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!config || !auth) { setStatus('disabled'); setMessage('Cloud sync is not configured for this build.'); return { ok: false, pendingConfirmation: false }; }
    setStatus('syncing'); setMessage('Creating account…');
    const result = await auth.signUp(email, password);
    if (result.status === 'pending') { setStatus('signed-out'); setMessage(result.message); return { ok: true, pendingConfirmation: true }; }
    if (!isAuthSuccess(result)) { setStatus('error'); setMessage(errorMessage(result)); return { ok: false, pendingConfirmation: false }; }
    const saved = await saveSession(result.session);
    if (saved.status !== 'success') { setStatus('error'); setMessage(saved.message); return { ok: false, pendingConfirmation: false }; }
    sessionRef.current = result.session;
    setStatus('signed-out');
    setMessage('Account created. Checking Done Yet? Pro access…');
    return { ok: true, pendingConfirmation: false };
  }, [auth, config, saveSession]);

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

  /** A sync the app decided to run: the periodic tick and the scheduled retry. Leaves the backoff
   * alone, so repeated automatic failures keep spacing themselves out. */
  const syncTick = useCallback(() => {
    const accessError = proAccessReason(access, 'cloud sync');
    if (accessError) { setMessage(`${accessError} Your local data is safe on this device.`); return Promise.resolve(false); }
    const session = sessionRef.current;
    if (!config) { setStatus('disabled'); setMessage('Cloud sync is not configured for this build.'); return Promise.resolve(false); }
    if (!session) { setStatus('signed-out'); setMessage('Sign in to sync this device.'); return Promise.resolve(false); }
    return syncWith(state, session);
  }, [access, config, state, syncWith]);

  /** A sync the user asked for. Pressing Sync is a statement that something has changed — usually
   * that they are back online — so it starts from the shortest delay again instead of honouring a
   * backoff they cannot see. */
  const syncNow = useCallback(() => {
    retryRef.current = afterWake();
    setRetry(noRetry);
    return syncTick();
  }, [syncTick]);

  // Authentication is needed before RevenueCat can bind the subscription to the Supabase UUID.
  // Once that separate check resolves to Pro, perform the first sync exactly once for this user.
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || !state || entitlementResolving || !isPro) {
      if (!current || (!entitlementResolving && !isPro)) initialSyncUserRef.current = null;
      return;
    }
    if (initialSyncUserRef.current === current.userId) return;
    initialSyncUserRef.current = current.userId;
    void syncWith(state, current);
  }, [state, isPro, entitlementResolving, syncWith]);

  // Two schedules in one timer: the steady tick while everything is healthy, and the backoff after
  // a failure. The old version only ran from the synced state, which meant one dropped connection
  // stopped cloud sync until the user noticed and pressed Sync — on a phone, that could be days.
  useEffect(() => {
    if (!state || !sessionRef.current || !isPro) return;
    const delay = status === 'synced' ? 30_000 : msUntilDue(retry, new Date());
    if (delay === null) return;
    const timer = setTimeout(() => { void syncTick(); }, delay);
    return () => clearTimeout(timer);
  }, [state, status, retry, isPro, syncTick]);

  // Coming back to the app is the strongest signal available that the network may be back — timers
  // are throttled in the background, so without this a device that failed while backgrounded would
  // wait out a stale schedule before trying.
  useEffect(() => {
    const listener = DeviceAppState.addEventListener('change', value => {
      if (value !== 'active' || !sessionRef.current || !isPro) return;
      retryRef.current = afterWake();
      setRetry(noRetry);
      void syncTick();
    });
    return () => listener.remove();
  }, [isPro, syncTick]);

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
    if (status !== 'synced' || !sessionRef.current || !isPro) return;
    void drainAttachments(sessionRef.current);
  }, [status, drainAttachments, isPro]);

  // Draining only on a status transition misses the common case: the queue gains an entry
  // while already synced, so nothing changes and the effect never re-runs. Drain on enqueue too.
  const enqueueUpload = useCallback(async (attachment: Attachment) => {
    const accessError = proAccessReason(access, 'cloud attachments');
    if (accessError) { setMessage(accessError); return; }
    if (!config) return;
    await enqueueAttachmentUpload(attachment);
    if (sessionRef.current) void drainAttachments(sessionRef.current);
  }, [access, config, drainAttachments]);
  const enqueueDelete = useCallback(async (attachment: Pick<Attachment, 'id' | 'remoteKey'>) => {
    if (!config) return;
    await enqueueAttachmentDelete(attachment);
    if (sessionRef.current) void drainAttachments(sessionRef.current);
  }, [config, drainAttachments]);

  const downloadAttachment = useCallback(async (attachment: Attachment): Promise<AttachmentDownloadOutcome> => {
    const accessError = proAccessReason(access, 'cloud attachments');
    if (accessError) return { ok: false, message: `${accessError} Existing files can still be removed.` };
    if (!config) return { ok: false, message: 'Cloud sync is not configured for this build.' };
    if (!sessionRef.current) return { ok: false, message: 'Sign in to download this file.' };
    if (!attachment.remoteKey) return { ok: false, message: 'This attachment has no cloud copy.' };
    const client = createAttachmentsClient({ url: config.url, apiKey: config.anonKey, token: sessionStore.token });
    const result = await client.downloadAttachment(attachment.remoteKey);
    return isCloudSuccess(result) ? { ok: true, localName: result.value.localName } : { ok: false, message: errorMessage(result) };
  }, [access, config, sessionStore]);

  return {
    configured: !!config,
    status,
    email: session?.email ?? (session?.userId ? emailFromUserId(session.userId) : null),
    lastSyncedAt,
    message: message || sessionError,
    remoteVersion,
    signedIn: !!session,
    userId: session?.userId ?? null,
    token: sessionStore.token,
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
