import * as React from 'react';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import type { AppState } from '../../../../src/domain/types';
import { widgetView } from '../../../../src/domain/widget';
import { NextTaskWidget } from './NextTaskWidget';
import { widgetScope } from './widgetScope';
import { WIDGET_NAME } from './constants';

/**
 * Pushes a fresh render to every "Done Yet?" widget already on the home screen, from the running
 * app. Call this whenever `state` changes and once on app start (see application/MobileApp.tsx) —
 * it covers "the app is open"; registerNextTaskWidgetHandler's headless task covers Android's own
 * periodic background refresh so the widget still updates when the app is not running.
 *
 * Each widget is rendered for its own measurements and its own scope: `renderWidget` runs once per
 * instance on the home screen, so two widgets get the tier each has room for and the project each
 * was configured for, rather than one layout stretched to both.
 *
 * Best-effort and silent: a widget is a nice-to-have, so a failure here (no widget added yet, the
 * native module missing on this platform/build) must never surface as an app error.
 */
export async function updateWidget(state: AppState): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: async ({ width, height, widgetId }) =>
        React.createElement(NextTaskWidget, {
          view: widgetView(state, new Date(), { width, height }, await widgetScope.read(widgetId)),
        }),
    });
  } catch {
    // No widget on the home screen, or the native module isn't present — nothing to do.
  }
}
