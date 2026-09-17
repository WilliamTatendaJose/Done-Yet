/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
let db: DatabaseSync;
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({
  execAsync: async (sql: string) => { db.exec(sql); },
  getFirstAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) ?? null,
  getAllAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args),
  runAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).run(...args),
  withExclusiveTransactionAsync: async (operation: (tx: { runAsync: (sql: string, ...args: string[]) => Promise<unknown> }) => Promise<void>) => {
    db.exec('BEGIN');
    try { await operation({ runAsync: async (sql, ...args) => db.prepare(sql).run(...args) }); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
}) }));
beforeEach(() => { vi.resetModules(); db?.close(); db = new DatabaseSync(':memory:'); });

const at = (minute: number) => `2026-09-14T10:${String(minute).padStart(2, '0')}:00.000Z`;

describe('the widget command queue', () => {
  it('reads back what was queued, oldest first, with the time it was raised', async () => {
    const { commandQueue } = await import('./commandQueue');
    await commandQueue.enqueue('first', at(1));
    await commandQueue.enqueue('second', at(2));
    expect((await commandQueue.read()).map(row => [row.payload, row.at])).toEqual([['first', at(1)], ['second', at(2)]]);
  });

  it('starts empty and stays empty when nothing was queued', async () => {
    const { commandQueue } = await import('./commandQueue');
    expect(await commandQueue.read()).toEqual([]);
    await commandQueue.clearThrough(99);
    expect(await commandQueue.read()).toEqual([]);
  });

  it('clears only through the row that was drained, keeping a press made mid-drain', async () => {
    const { commandQueue } = await import('./commandQueue');
    await commandQueue.enqueue('drained', at(1));
    const [drained] = await commandQueue.read();
    await commandQueue.enqueue('arrived-during-the-drain', at(2));
    await commandQueue.clearThrough(drained.id);
    expect((await commandQueue.read()).map(row => row.payload)).toEqual(['arrived-during-the-drain']);
  });

  it('binds payloads as parameters rather than SQL', async () => {
    const { commandQueue } = await import('./commandQueue');
    const payload = "'); DROP TABLE pending_commands; --";
    await commandQueue.enqueue(payload, at(1));
    expect((await commandQueue.read())[0].payload).toBe(payload);
  });

  it('bounds the queue when the app is never opened to drain it', async () => {
    const { commandQueue } = await import('./commandQueue');
    for (let index = 0; index < 120; index++) await commandQueue.enqueue(`press-${index}`, at(1));
    const rows = await commandQueue.read();
    expect(rows).toHaveLength(100);
    // The oldest are the ones dropped: the newest presses are the ones that still reflect intent.
    expect(rows[rows.length - 1].payload).toBe('press-119');
    expect(rows[0].payload).toBe('press-20');
  });
});
