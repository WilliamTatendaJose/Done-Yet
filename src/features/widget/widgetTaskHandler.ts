import * as React from 'react';
import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import type { WidgetSummary } from '../../../../src/domain/widget';
import { widgetSummary } from '../../../../src/domain/widget';
import { decodeState } from '../../../../src/state/storage';
import { repository } from '../../state/database';
import { NextTaskWidget } from './NextTaskWidget';

const EMPTY_SUMMARY: WidgetSummary = { openCount: 0, nextTitle: null, nextDueBucket: null, nextDueLabel: null };

async function currentSummary(): Promise<WidgetSummary> {
  try {
    const raw = await repository.read();
    if (!raw) return EMPTY_SUMMARY;
    return widgetSummary(decodeState(raw), new Date());
  } catch {
    // A damaged or unreadable snapshot degrades to the empty state rather than a stale or crashed widget.
    return EMPTY_SUMMARY;
  }
}

async function handler({ widgetAction, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  const summary = await currentSummary();
  renderWidget(React.createElement(NextTaskWidget, { summary }));
}

/**
 * Registers the headless task Android runs for the "Done Yet?" widget: when one is added, resized,
 * or on its own `updatePeriodMillis` timer (see constants.ts / the app.json config this still
 * needs), independently of whether the app is foregrounded or even running. Reads the persisted
 * snapshot straight from the same SQLite-backed repository the full app uses — there is no live
 * app state to read from in this context — so the widget stays correct without the app being open.
 * Call once, at module load (see mobile/index.ts), same as `registerRootComponent`.
 */
export function registerNextTaskWidgetHandler(): void {
  registerWidgetTaskHandler(handler);
}
