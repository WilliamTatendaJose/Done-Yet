/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
let db: DatabaseSync;
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => ({
  execAsync: async (sql: string) => { db.exec(sql); },
  getFirstAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).get(...args) ?? null,
  runAsync: async (sql: string, ...args: (string | number)[]) => db.prepare(sql).run(...args),
  withExclusiveTransactionAsync: async (operation: (tx: { runAsync: (sql: string, ...args: string[]) => Promise<unknown> }) => Promise<void>) => {
    db.exec('BEGIN');
    try { await operation({ runAsync: async (sql, ...args) => db.prepare(sql).run(...args) }); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  },
}) }));
beforeEach(() => { vi.resetModules(); db?.close(); db = new DatabaseSync(':memory:'); });
describe('SQLite storage transactions', () => {
  it('roundtrips snapshots and retains one previous committed version', async () => {
    const { repository, readMetadata } = await import('./database');
    expect(await repository.read()).toBeNull();
    await repository.write('first'); await repository.write('second');
    expect(await repository.read()).toBe('second'); expect(await readMetadata('previous_snapshot')).toBe('first');
  });
  it('rolls back the backup and current state together if a write fails', async () => {
    const { repository, readMetadata } = await import('./database');
    await repository.write('first'); await repository.write('second');
    db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT, 'disk error'); END;");
    await expect(repository.write('third')).rejects.toThrow();
    expect(await repository.read()).toBe('second'); expect(await readMetadata('previous_snapshot')).toBe('first');
  });
  it('binds task data as parameters rather than SQL', async () => {
    const { repository } = await import('./database');
    const payload = "'); DROP TABLE app_state; --";
    await repository.write(payload); expect(await repository.read()).toBe(payload);
  });
});
