import { describe, expect, it } from 'vitest';
import { createController, type StateRepository } from './controller';
import { initialState } from '../../../src/state/model';
const now = new Date('2026-09-12T10:00:00Z');
function memory(raw: string | null = null) {
  let data = raw;
  const repository: StateRepository = { read: async () => data, write: async next => { data = next; } };
  return { repository, data: () => data };
}
describe('durable mobile commands', () => {
  it('starts empty and writes an initial snapshot before exposing it', async () => {
    const db = memory(); const store = createController(db.repository, () => now);
    await store.load(); expect(store.getSnapshot().state?.tasks).toEqual([]); expect(db.data()).not.toBeNull();
  });
  it('does not publish an edit before persistence completes', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    let release!: () => void; db.repository.write = () => new Promise(resolve => { release = resolve; });
    const pending = store.dispatch({ type: 'completeTask', id: 'sample-outline' });
    await Promise.resolve(); await Promise.resolve();
    expect(store.getSnapshot().state?.tasks[0].status).toBe('todo'); expect(store.getSnapshot().saving).toBe(true);
    release(); expect(await pending).toBe(true); expect(store.getSnapshot().state?.tasks[0].status).toBe('done');
  });
  it('preserves previous state on a failed save and allows retry', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    const write = db.repository.write; db.repository.write = async () => { throw Error('disk full'); };
    expect(await store.dispatch({ type: 'completeTask', id: 'sample-outline' })).toBe(false);
    expect(store.getSnapshot().state?.tasks[0].status).toBe('todo'); expect(store.getSnapshot().error).toContain('not saved');
    db.repository.write = write; expect(await store.dispatch({ type: 'completeTask', id: 'sample-outline' })).toBe(true);
    expect(store.getSnapshot().error).toBe('');
  });
  it('serializes concurrent commands without losing edits', async () => {
    const db = memory(); const store = createController(db.repository, () => now); await store.load();
    await Promise.all(['a', 'b', 'c'].map(id => store.dispatch({ type: 'addTask', id, input: { title: id } })));
    expect(store.getSnapshot().state?.tasks.map(t => t.id)).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(db.data()!).tasks).toHaveLength(3); expect(store.getSnapshot().saving).toBe(false);
  });
  it('preserves corrupt data and can recover from a validated backup', async () => {
    const db = memory(''); const store = createController(db.repository, () => now); await store.load();
    expect(store.getSnapshot().state).toBeNull(); expect(db.data()).toBe('');
    expect(() => store.replace('{')).toThrow(); expect(db.data()).toBe('');
    const backup = initialState(now); backup.settings.nativeNotificationsEnabled = true;
    expect(await store.replace(JSON.stringify(backup))).toBe(true);
    expect(store.getSnapshot().state?.settings.nativeNotificationsEnabled).toBe(false);
  });
  it('applies queued commands at the time each was raised, not the time they are drained', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    const raised = new Date('2026-09-12T09:00:00Z');
    expect(await store.applyQueued([{ action: { type: 'snoozeTask', id: 'sample-outline', minutes: 15 }, at: raised }])).toBe(true);
    // 09:15, from when the button was pressed — not 10:15, an hour later, when the app was reopened.
    expect(store.getSnapshot().state?.tasks[0].snoozedUntil).toBe('2026-09-12T09:15:00.000Z');
  });
  it('applies a batch of queued commands in order, as one save', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    let writes = 0; const write = db.repository.write; db.repository.write = async next => { writes++; await write(next); };
    expect(await store.applyQueued([
      { action: { type: 'snoozeTask', id: 'sample-outline', minutes: 15 }, at: now },
      { action: { type: 'completeTask', id: 'sample-outline' }, at: now },
    ])).toBe(true);
    expect(store.getSnapshot().state?.tasks[0].status).toBe('done');
    expect(writes).toBe(1);
  });
  it('refuses to apply queued commands before state has loaded, so they stay queued', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now);
    expect(await store.applyQueued([{ action: { type: 'completeTask', id: 'sample-outline' }, at: now }])).toBe(false);
    await store.load(); expect(store.getSnapshot().state?.tasks[0].status).toBe('todo');
  });
  it('reports success for a queued command the app has already made moot, so it stops being queued', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    await store.dispatch({ type: 'completeTask', id: 'sample-outline' });
    expect(await store.applyQueued([{ action: { type: 'completeTask', id: 'sample-outline' }, at: now }])).toBe(true);
    expect(store.getSnapshot().state?.tasks[0].status).toBe('done');
  });
  it('keeps queued commands when the save fails', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    db.repository.write = async () => { throw Error('disk full'); };
    expect(await store.applyQueued([{ action: { type: 'completeTask', id: 'sample-outline' }, at: now }])).toBe(false);
    expect(store.getSnapshot().state?.tasks[0].status).toBe('todo');
  });
  it('does not reopen a task when a completion action is delivered twice', async () => {
    const db = memory(JSON.stringify(initialState(now))); const store = createController(db.repository, () => now); await store.load();
    await Promise.all([store.dispatch({ type: 'completeTask', id: 'sample-outline' }), store.dispatch({ type: 'completeTask', id: 'sample-outline' })]);
    expect(store.getSnapshot().state?.tasks[0].status).toBe('done');
  });
});
