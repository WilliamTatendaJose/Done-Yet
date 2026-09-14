import { describe, expect, it, vi } from 'vitest';
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0 }));
import { createSecureCloudSessionStore, type SecureValueStore } from './session';

function memory(): { store: SecureValueStore; read: () => string | null } {
  let value: string | null = null;
  return {
    store: {
      isAvailableAsync: async () => true,
      getItemAsync: async () => value,
      setItemAsync: async (_key, next) => { value = next; },
      deleteItemAsync: async () => { value = null; },
    },
    read: () => value,
  };
}

describe('secure cloud sessions', () => {
  it('persists credentials and supplies a just-in-time token', async () => {
    const store = memory(); const sessions = createSecureCloudSessionStore({ store: store.store });
    await sessions.save({ userId: 'user-1', accessToken: 'access', refreshToken: 'refresh' });
    expect(store.read()).toContain('access');
    expect(await sessions.token()).toBe('access');
    expect((await sessions.load())).toMatchObject({ status: 'success', value: { userId: 'user-1' } });
  });
  it('rejects malformed persisted sessions and clears a valid one', async () => {
    const store = memory(); const sessions = createSecureCloudSessionStore({ store: store.store });
    expect((await sessions.save({ userId: '', accessToken: 'access' })).status).toBe('invalid');
    await sessions.save({ userId: 'user-1', accessToken: 'access' });
    await sessions.clear();
    expect(await sessions.token()).toBeNull();
  });
});
