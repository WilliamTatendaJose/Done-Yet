import type { WidgetScope } from '../../../../src/domain/widget';
import { deleteMetadata, readMetadata, writeMetadata } from '../../state/database';

/** One row per widget instance, keyed by the id Android assigns it. */
const key = (widgetId: number) => `widget_scope_${widgetId}`;

/**
 * What each home-screen widget was configured to show. Two widgets can be scoped differently — one
 * for a project, one for everything — so this is stored per widget id rather than in app settings,
 * which are the user's preferences rather than one widget's.
 *
 * It lives in `app_metadata` rather than in the snapshot on purpose: a widget's configuration is
 * device-local furniture, not user data. Keeping it out of the snapshot keeps it out of cloud sync
 * and out of an exported backup, where another device's widget ids would be meaningless anyway.
 *
 * Every read is best-effort: a widget that cannot read its configuration shows everything, which is
 * the same thing an unconfigured widget shows.
 */
export const widgetScope = {
  async read(widgetId: number): Promise<WidgetScope> {
    try {
      const raw = await readMetadata(key(widgetId));
      if (!raw) return {};
      const value = JSON.parse(raw) as Record<string, unknown>;
      const projectId = value.projectId;
      if (typeof projectId === 'string' && projectId) return { projectId };
      if (projectId === null) return { projectId: null };
      return {};
    } catch {
      return {};
    }
  },
  async write(widgetId: number, scope: WidgetScope): Promise<void> {
    // `undefined` (everything) and `null` (tasks belonging to no project) mean different things, and
    // JSON.stringify drops an undefined value — which is exactly the empty scope `read` returns.
    await writeMetadata(key(widgetId), JSON.stringify({ projectId: scope.projectId }));
  },
  /** Called when a widget is removed from the home screen — Android reuses widget ids, so a stale
   * row would otherwise silently become some future widget's configuration. */
  async clear(widgetId: number): Promise<void> {
    await deleteMetadata(key(widgetId));
  },
};
