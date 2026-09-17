import * as React from 'react';
import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { AppState } from '../../../../src/domain/types';
import type { WidgetScope, WidgetSize, WidgetView } from '../../../../src/domain/widget';
import { widgetTier, widgetView } from '../../../../src/domain/widget';
import { reduce } from '../../../../src/state/model';
import { decodeState } from '../../../../src/state/storage';
import { repository } from '../../state/database';
import { commandQueue } from '../../state/commandQueue';
import { clickCommand, commandAction, encodeCommand, parseCommand } from './commands';
import { widgetScope } from './widgetScope';
import { NextTaskWidget } from './NextTaskWidget';

const emptyView = (size: WidgetSize): WidgetView => ({ tier: widgetTier(size), openCount: 0, rows: [], scopeLabel: null, focus: null });

/**
 * What the widget should show at its own size: the persisted snapshot with any not-yet-drained
 * widget taps applied on top. Those taps are real to the user the moment they make them, but the
 * app — the only writer of the snapshot — may not run for hours, so replaying the queue here is
 * what keeps a tapped "Done" from springing back until then. It is a projection only; nothing is
 * written.
 */
async function currentView(size: WidgetSize, scope: WidgetScope): Promise<WidgetView> {
  try {
    const raw = await repository.read();
    if (!raw) return emptyView(size);
    const queued = await commandQueue.read();
    const state = queued.reduce<AppState>((current, row) => {
      const command = parseCommand(row.payload);
      const at = new Date(row.at);
      return command && Number.isFinite(at.getTime()) ? reduce(current, commandAction(command), at) : current;
    }, decodeState(raw));
    return widgetView(state, new Date(), size, scope);
  } catch {
    // A damaged or unreadable snapshot degrades to the empty state rather than a stale or crashed widget.
    return emptyView(size);
  }
}

async function handler({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') {
    // Android reuses widget ids, so a removed widget's scope has to go with it or it becomes some
    // future widget's surprise configuration.
    await widgetScope.clear(widgetInfo.widgetId).catch(() => undefined);
    return;
  }
  if (widgetAction === 'WIDGET_CLICK') {
    // `OPEN_APP` and `OPEN_URI` never reach JS; only the widget's own buttons do. An action this
    // build does not recognise (an older widget left on the home screen across an app update) is
    // ignored rather than guessed at.
    const command = clickCommand(clickAction, clickActionData);
    if (!command) return;
    try {
      await commandQueue.enqueue(encodeCommand(command), new Date().toISOString());
    } catch {
      // Nothing was queued, so nothing will happen — leave the widget showing the truth rather
      // than re-rendering as though the tap had taken effect.
      return;
    }
  }
  const size = { width: widgetInfo.width, height: widgetInfo.height };
  const scope = await widgetScope.read(widgetInfo.widgetId);
  renderWidget(React.createElement(NextTaskWidget, { view: await currentView(size, scope) }));
}

/**
 * Registers the headless task Android runs for the "Done Yet?" widget: when one is added, resized,
 * on its own `updatePeriodMillis` timer, or when one of its buttons is pressed — independently of
 * whether the app is foregrounded or even running. Reads the persisted snapshot straight from the
 * same SQLite-backed repository the full app uses — there is no live app state to read from in this
 * context — so the widget stays correct without the app being open, and queues button presses for
 * the app to apply rather than writing state behind its back (see state/commandQueue.ts).
 *
 * WIDGET_RESIZED arrives here like any other action, so dragging the widget bigger or smaller
 * re-renders it at whatever tier its new size affords.
 * Call once, at module load (see mobile/index.ts), same as `registerRootComponent`.
 */
export function registerNextTaskWidgetHandler(): void {
  registerWidgetTaskHandler(handler);
}
