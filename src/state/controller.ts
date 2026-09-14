import type { AppState } from '../../../src/domain/types';
import { initialState, reduce, type Action } from '../../../src/state/model';
import { decodeState } from '../../../src/state/storage';

export interface StateRepository { read(): Promise<string | null>; write(snapshot: string): Promise<void>; }
export interface StoreSnapshot { state: AppState | null; saving: boolean; error: string; }
/** Commands serialize and publish only after durable storage acknowledges the write. */
export function createController(repository: StateRepository, clock = () => new Date()) {
  let snapshot: StoreSnapshot = { state: null, saving: false, error: '' };
  let queue: Promise<unknown> = Promise.resolve();
  let loading: Promise<void> | undefined;
  let pending = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<StoreSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(fn => fn()); };
  const load = () => loading ??= (async () => {
    try {
      const raw = await repository.read();
      const state = raw === null ? { ...initialState(clock()), tasks: [], projects: [] } : decodeState(raw);
      if (raw === null) await repository.write(JSON.stringify(state));
      publish({ state, error: '' });
    } catch { publish({ error: 'Your data could not be opened. It has been kept intact. Tap Retry to try again.' }); }
    finally { loading = undefined; }
  })();
  function transact(change: (state: AppState | null) => AppState | null): Promise<boolean> {
    pending++; publish({ saving: true });
    const operation = queue.catch(() => undefined).then(async () => {
      try {
        const next = change(snapshot.state);
        if (!next) return false;
        if (next === snapshot.state) return true;
        const serialized = JSON.stringify(next);
        decodeState(serialized);
        await repository.write(serialized);
        publish({ state: next, error: '' });
        return true;
      } catch { publish({ error: 'Change not saved. Your previous data is safe. Free device storage and try again.' }); return false; }
    }).finally(() => { pending--; publish({ saving: pending > 0 }); });
    queue = operation;
    return operation;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    dispatch: (action: Action) => { const now = clock(); return transact(state => state ? reduce(state, action, now) : null); },
    replace: (raw: string) => { const imported = decodeState(raw); return transact(() => ({ ...imported, focus: null, settings: { ...imported.settings, nativeNotificationsEnabled: false } })); },
    /** Apply a validated cloud snapshot while keeping device-only notification consent. */
    replaceRemote: (raw: string) => transact(current => {
      const imported = decodeState(raw);
      return {
        ...imported,
        focus: null,
        settings: {
          ...imported.settings,
          ...(current?.settings.nativeNotificationsEnabled === undefined ? {} : { nativeNotificationsEnabled: current.settings.nativeNotificationsEnabled }),
        },
      };
    }),
  };
}
