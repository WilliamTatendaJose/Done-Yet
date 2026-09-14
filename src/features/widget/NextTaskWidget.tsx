import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetSummary } from '../../../../src/domain/widget';
import { colors } from '../../theme';

/**
 * Purely presentational: every decision about what to show (empty state vs. next task, the due
 * label) already happened in the pure `widgetSummary`. Renders one opaque card using the app's own
 * (always-dark, see theme.ts/app.json userInterfaceStyle) palette rather than trying to adapt to
 * the home screen's own light/dark setting — the app has no separate light palette to switch to,
 * and a self-contained background/foreground pair reads fine against either wallpaper theme.
 * Tapping anywhere on the widget opens the app (`clickAction="OPEN_APP"` is handled natively by
 * react-native-android-widget and never reaches JS).
 */
export function NextTaskWidget({ summary }: { summary: WidgetSummary }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={summary.openCount === 0 ? 'Done Yet?: nothing waiting on you' : `Done Yet?: ${summary.nextTitle}, ${summary.nextDueLabel}`}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        flexDirection: 'column',
        justifyContent: 'center',
      }}
    >
      {summary.openCount === 0 ? (
        <TextWidget text="Nothing waiting on you" style={{ color: colors.text, fontSize: 14, fontWeight: '700' }} maxLines={2} truncate="END" />
      ) : (
        <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
          <TextWidget text={summary.nextTitle ?? ''} style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} maxLines={2} truncate="END" />
          <TextWidget text={summary.nextDueLabel ?? ''} style={{ color: colors.accent, fontSize: 12, fontWeight: '600', marginTop: 4 }} />
          <TextWidget
            text={summary.openCount === 1 ? '1 task open' : `${summary.openCount} tasks open`}
            style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}
          />
        </FlexWidget>
      )}
    </FlexWidget>
  );
}
