import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import type { CloudTokenProvider } from './runtime';

const DEFAULT_KEY = 'done-yet.cloud-session.v1';

export interface CloudSession {
  userId: string;
  accessToken: string;
  email?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface SecureValueStore {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStore.SecureStoreOptions): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export type CloudSessionResult =
  | { status: 'success'; value: CloudSession | null }
  | { status: 'unavailable' | 'invalid' | 'error'; message: string };

export interface CloudSessionStore {
  load(): Promise<CloudSessionResult>;
  save(session: CloudSession): Promise<CloudSessionResult>;
  clear(): Promise<CloudSessionResult>;
  token: CloudTokenProvider;
}

export interface SecureCloudSessionOptions {
  key?: string;
  store?: SecureValueStore;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function validateSession(value: unknown): CloudSession | null {
  if (!isObject(value) || typeof value.userId !== 'string' || !value.userId.trim() || typeof value.accessToken !== 'string' || !value.accessToken.trim()) return null;
  if (value.email !== undefined && (typeof value.email !== 'string' || !value.email.trim())) return null;
  if (value.refreshToken !== undefined && typeof value.refreshToken !== 'string') return null;
  if (value.expiresAt !== undefined && (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)))) return null;
  return {
    userId: value.userId,
    accessToken: value.accessToken,
    ...(typeof value.email === 'string' ? { email: value.email.trim() } : {}),
    ...(typeof value.refreshToken === 'string' ? { refreshToken: value.refreshToken } : {}),
    ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
  };
}

/**
 * Stores only short session credentials, never task data or snapshots. The
 * default accessibility limits iOS keychain access to an unlocked device and
 * prevents credential migration to a different device backup.
 */
export function createSecureCloudSessionStore(options: SecureCloudSessionOptions = {}): CloudSessionStore {
  const key = options.key ?? DEFAULT_KEY;
  const store = options.store ?? SecureStore;
  let cached: CloudSession | null | undefined;
  const available = async () => {
    try { return await store.isAvailableAsync(); }
    catch { return false; }
  };
  const load = async (): Promise<CloudSessionResult> => {
      if (!(await available())) return { status: 'unavailable', message: 'Secure credential storage is unavailable on this device.' };
      try {
        const raw = await store.getItemAsync(key);
        if (raw === null) { cached = null; return { status: 'success', value: null }; }
        const session = validateSession(JSON.parse(raw));
        if (!session) return { status: 'invalid', message: 'The saved cloud session is invalid. Sign in again.' };
        cached = session;
        return { status: 'success', value: session };
      } catch { return { status: 'error', message: 'Cloud session could not be read securely.' }; }
  };
  const save = async (session: CloudSession): Promise<CloudSessionResult> => {
      const valid = validateSession(session);
      if (!valid) return { status: 'invalid', message: 'Cloud session is invalid.' };
      if (!(await available())) return { status: 'unavailable', message: 'Secure credential storage is unavailable on this device.' };
      try {
        await store.setItemAsync(key, JSON.stringify(valid), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
        cached = valid;
        return { status: 'success', value: valid };
      } catch { return { status: 'error', message: 'Cloud session could not be saved securely.' }; }
  };
  const clear = async (): Promise<CloudSessionResult> => {
      if (!(await available())) return { status: 'unavailable', message: 'Secure credential storage is unavailable on this device.' };
      try { await store.deleteItemAsync(key); cached = null; return { status: 'success', value: null }; }
      catch { return { status: 'error', message: 'Cloud session could not be cleared securely.' }; }
  };
  const token = async () => {
      if (cached === undefined) {
        const result = await load();
        if (result.status !== 'success') return null;
      }
      return cached?.accessToken ?? null;
  };
  return { load, save, clear, token };
}

export interface UseCloudSessionResult {
  session: CloudSession | null;
  status: 'loading' | 'ready' | 'unavailable' | 'invalid' | 'error';
  error: string;
  reload(): Promise<CloudSessionResult>;
  save(session: CloudSession): Promise<CloudSessionResult>;
  clear(): Promise<CloudSessionResult>;
}

/** React adapter for a settings or account screen; it has no UI policy of its own. */
export function useCloudSession(store: CloudSessionStore): UseCloudSessionResult {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [status, setStatus] = useState<UseCloudSessionResult['status']>('loading');
  const [error, setError] = useState('');
  const apply = useCallback(async (operation: () => Promise<CloudSessionResult>) => {
    const result = await operation();
    setStatus(result.status === 'success' ? 'ready' : result.status);
    if (result.status === 'success') { setSession(result.value); setError(''); }
    else setError(result.message);
    return result;
  }, []);
  const reload = useCallback(() => apply(() => store.load()), [apply, store]);
  const save = useCallback((next: CloudSession) => apply(() => store.save(next)), [apply, store]);
  const clear = useCallback(() => apply(() => store.clear()), [apply, store]);
  useEffect(() => { void reload(); }, [reload]);
  return { session, status, error, reload, save, clear };
}
