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

describe('a widget instance remembering what it watches', () => {
  it('shows everything until it has been configured', async () => {
    const { widgetScope } = await import('./widgetScope');
    expect(await widgetScope.read(7)).toEqual({});
  });

  it('round-trips a project scope', async () => {
    const { widgetScope } = await import('./widgetScope');
    await widgetScope.write(7, { projectId: 'kitchen' });
    expect(await widgetScope.read(7)).toEqual({ projectId: 'kitchen' });
  });

  it('keeps "no project" distinct from "everything"', async () => {
    // JSON.stringify drops an undefined value, which is what makes these two round-trip differently.
    const { widgetScope } = await import('./widgetScope');
    await widgetScope.write(7, { projectId: null });
    await widgetScope.write(8, {});
    expect(await widgetScope.read(7)).toEqual({ projectId: null });
    expect(await widgetScope.read(8)).toEqual({});
  });

  it('scopes each widget separately, so two can watch different things', async () => {
    const { widgetScope } = await import('./widgetScope');
    await widgetScope.write(7, { projectId: 'kitchen' });
    await widgetScope.write(8, { projectId: 'garden' });
    expect(await widgetScope.read(7)).toEqual({ projectId: 'kitchen' });
    expect(await widgetScope.read(8)).toEqual({ projectId: 'garden' });
  });

  it('replaces a scope rather than accumulating rows', async () => {
    const { widgetScope } = await import('./widgetScope');
    await widgetScope.write(7, { projectId: 'kitchen' });
    await widgetScope.write(7, {});
    expect(await widgetScope.read(7)).toEqual({});
  });

  it('forgets a removed widget, since Android reuses widget ids', async () => {
    const { widgetScope } = await import('./widgetScope');
    await widgetScope.write(7, { projectId: 'kitchen' });
    await widgetScope.clear(7);
    expect(await widgetScope.read(7)).toEqual({});
  });

  it('falls back to everything on a row it cannot read', async () => {
    const { widgetScope } = await import('./widgetScope');
    const { writeMetadata } = await import('../../state/database');
    await writeMetadata('widget_scope_7', '{ not json');
    expect(await widgetScope.read(7)).toEqual({});
    await writeMetadata('widget_scope_8', JSON.stringify({ projectId: 42 }));
    expect(await widgetScope.read(8)).toEqual({});
  });
});
