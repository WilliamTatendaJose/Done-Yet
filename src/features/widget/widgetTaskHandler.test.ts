/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { WidgetTaskHandler, WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { WidgetSize, WidgetView } from '../../../../src/domain/widget';
import { initialState } from '../../../../src/state/model';
import { CLICK_COMPLETE, CLICK_SNOOZE } from './commands';

let db: DatabaseSync;
let registered: WidgetTaskHandler | undefined;
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
vi.mock('react-native-android-widget', () => ({
  registerWidgetTaskHandler: (handler: WidgetTaskHandler) => { registered = handler; },
  FlexWidget: () => null,
  TextWidget: () => null,
}));

beforeEach(() => { vi.resetModules(); registered = undefined; db?.close(); db = new DatabaseSync(':memory:'); });

const now = new Date('2026-09-14T10:00:00Z');
/** The size the widget is added at, and a 3-cell-tall one the user has dragged out. */
const CARD: WidgetSize = { width: 250, height: 150 };
const TALL: WidgetSize = { width: 250, height: 260 };

/** Boots the headless task against a seeded snapshot and reports what it renders. */
async function widget() {
  const [{ registerNextTaskWidgetHandler }, { repository }, { commandQueue }] = await Promise.all([
    import('./widgetTaskHandler'), import('../../state/database'), import('../../state/commandQueue'),
  ]);
  await repository.write(JSON.stringify(initialState(now)));
  registerNextTaskWidgetHandler();
  const rendered: WidgetView[] = [];
  const run = async (props: Partial<WidgetTaskHandlerProps>, size: WidgetSize = CARD) => {
    await registered!({
      widgetAction: 'WIDGET_UPDATE',
      widgetInfo: { widgetName: 'NextTask', widgetId: 1, ...size },
      renderWidget: (element: unknown) => { rendered.push((element as { props: { view: WidgetView } }).props.view); },
      ...props,
    } as WidgetTaskHandlerProps);
    return rendered[rendered.length - 1];
  };
  return { run, rendered, commandQueue };
}

describe('the widget headless task', () => {
  it('shows the next task on a plain refresh', async () => {
    const { run } = await widget();
    const view = await run({ widgetAction: 'WIDGET_UPDATE' });
    expect(view.tier).toBe('card');
    expect(view.rows[0].id).toBe('sample-outline');
  });

  it('renders nothing on deletion, since there is no widget left to draw', async () => {
    const { run, rendered } = await widget();
    await run({ widgetAction: 'WIDGET_DELETED' });
    expect(rendered).toHaveLength(0);
  });

  it('forgets a deleted widget’s scope, since Android hands the id out again', async () => {
    const { run } = await widget();
    const { widgetScope } = await import('./widgetScope');
    await widgetScope.write(1, { projectId: 'kitchen' });
    await run({ widgetAction: 'WIDGET_DELETED' });
    expect(await widgetScope.read(1)).toEqual({});
  });

  it('queues a Done press and immediately moves on to the next task', async () => {
    const { run, commandQueue } = await widget();
    const view = await run({ widgetAction: 'WIDGET_CLICK', clickAction: CLICK_COMPLETE, clickActionData: { taskId: 'sample-outline' } });
    // The app is the only writer, so the press is queued, not applied to the snapshot...
    expect((await commandQueue.read()).map(row => JSON.parse(row.payload))).toEqual([{ kind: 'complete', taskId: 'sample-outline' }]);
    // ...but the widget must not show the task springing back while it waits to be drained.
    expect(view.rows[0].id).toBe('sample-proposal');
    expect(view.openCount).toBe(1);
  });

  it('keeps a completed task gone across later refreshes, before the app has ever run', async () => {
    const { run } = await widget();
    await run({ widgetAction: 'WIDGET_CLICK', clickAction: CLICK_COMPLETE, clickActionData: { taskId: 'sample-outline' } });
    expect((await run({ widgetAction: 'WIDGET_UPDATE' })).rows[0].id).toBe('sample-proposal');
  });

  it('empties out once every task has been pressed done', async () => {
    const { run } = await widget();
    for (const taskId of ['sample-outline', 'sample-proposal']) {
      await run({ widgetAction: 'WIDGET_CLICK', clickAction: CLICK_COMPLETE, clickActionData: { taskId } });
    }
    const view = await run({ widgetAction: 'WIDGET_UPDATE' });
    expect(view).toEqual({ tier: 'card', openCount: 0, rows: [], scopeLabel: null, focus: null });
  });

  it('queues a Snooze press and keeps showing the task it applies to', async () => {
    const { run, commandQueue } = await widget();
    const view = await run({ widgetAction: 'WIDGET_CLICK', clickAction: CLICK_SNOOZE, clickActionData: { taskId: 'sample-outline' } });
    expect((await commandQueue.read()).map(row => JSON.parse(row.payload).kind)).toEqual(['snooze']);
    // Snoozing defers a reminder; it does not close the task, so the widget still owes it to the user.
    expect(view.openCount).toBe(2);
  });

  it('ignores a press it cannot make sense of, queueing nothing and redrawing nothing', async () => {
    const { run, rendered, commandQueue } = await widget();
    await run({ widgetAction: 'WIDGET_CLICK', clickAction: 'ARCHIVE_TASK', clickActionData: { taskId: 'sample-outline' } });
    await run({ widgetAction: 'WIDGET_CLICK', clickAction: CLICK_COMPLETE, clickActionData: {} });
    expect(await commandQueue.read()).toEqual([]);
    expect(rendered).toHaveLength(0);
  });

  it('falls back to the empty state rather than crashing on an unreadable snapshot', async () => {
    const { run } = await widget();
    const { repository } = await import('../../state/database');
    await repository.write('{ not json');
    expect((await run({ widgetAction: 'WIDGET_UPDATE' })).openCount).toBe(0);
  });
});

describe('the widget headless task: rendering for the size it is', () => {
  it('lists several tasks once the widget is tall enough', async () => {
    const { run } = await widget();
    const view = await run({ widgetAction: 'WIDGET_UPDATE' }, TALL);
    expect(view.tier).toBe('list');
    expect(view.rows.map(row => row.id)).toEqual(['sample-outline', 'sample-proposal']);
  });

  it('re-renders at the new tier when the widget is resized', async () => {
    const { run } = await widget();
    expect((await run({ widgetAction: 'WIDGET_RESIZED' }, TALL)).tier).toBe('list');
    expect((await run({ widgetAction: 'WIDGET_RESIZED' }, { width: 250, height: 90 })).tier).toBe('compact');
  });

  it('renders only the project a widget is scoped to, and says which', async () => {
    const { run } = await widget();
    const { repository } = await import('../../state/database');
    const { widgetScope } = await import('./widgetScope');
    const seeded = initialState(now);
    await repository.write(JSON.stringify(seeded));
    // sample-outline belongs to the sample project; sample-proposal belongs to none.
    await widgetScope.write(1, { projectId: seeded.projects[0].id });
    const view = await run({ widgetAction: 'WIDGET_UPDATE' }, TALL);
    expect(view.rows.map(row => row.id)).toEqual(['sample-outline']);
    expect(view.openCount).toBe(1);
    expect(view.scopeLabel).toBe(seeded.projects[0].title);
  });

  it('completes the row that was pressed, not whichever task happens to be first', async () => {
    const { run, commandQueue } = await widget();
    const view = await run({ widgetAction: 'WIDGET_CLICK', clickAction: CLICK_COMPLETE, clickActionData: { taskId: 'sample-proposal' } }, TALL);
    expect((await commandQueue.read()).map(row => JSON.parse(row.payload).taskId)).toEqual(['sample-proposal']);
    expect(view.rows.map(row => row.id)).toEqual(['sample-outline']);
  });
});
