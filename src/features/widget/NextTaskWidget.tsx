import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetFocus, WidgetRow, WidgetView } from '../../../../src/domain/widget';
import { shortcutUrls } from '../shortcuts/deepLink';
import { CLICK_COMPLETE, CLICK_SNOOZE, SNOOZE_MINUTES } from './commands';
import { colors } from '../../theme';

/**
 * Purely presentational: every decision about what to show — which tier the widget's current size
 * affords, how many tasks, how each deadline reads — already happened in the pure `widgetView`.
 * Renders one opaque card using the app's own (always-dark, see theme.ts/app.json
 * userInterfaceStyle) palette rather than trying to adapt to the home screen's own light/dark
 * setting — the app has no separate light palette to switch to, and a self-contained
 * background/foreground pair reads fine against either wallpaper theme.
 *
 * Two kinds of tap, deliberately distinguished:
 *  - Navigation (a task, Focus, Add, the open count) opens the app at a `doneyet://` link, which
 *    Android handles natively — see features/shortcuts/deepLink.ts.
 *  - Done and Snooze carry their own `clickAction`, so they reach the headless task instead
 *    (widgetTaskHandler.ts) and finish without the app ever coming to the foreground. Even then the
 *    widget writes no state: the press is queued for the app to apply, so the running app stays the
 *    single writer of the snapshot (state/commandQueue.ts explains why that matters).
 * The card's own background stays `OPEN_APP`, so a tap that lands between regions still does the
 * obvious thing; a child's `clickAction` takes precedence over it where one is set.
 */
export function NextTaskWidget({ view }: { view: WidgetView }) {
  const [next] = view.rows;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={describe(view)}
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: colors.surface,
        borderColor: next?.overdue ? colors.warning : colors.border,
        borderWidth: 1,
        borderRadius: 18,
        padding: view.tier === 'compact' ? 10 : 12,
        flexDirection: 'column',
        justifyContent: view.tier === 'list' ? 'flex-start' : 'center',
      }}
    >
      {view.focus ? <Focus focus={view.focus} tier={view.tier} /> : view.rows.length === 0 ? <Empty tier={view.tier} scopeLabel={view.scopeLabel} /> : view.tier === 'compact' ? <Compact view={view} next={next} /> : view.tier === 'list' ? <List view={view} /> : <Card view={view} next={next} />}
    </FlexWidget>
  );
}

/** One label for the whole widget, since a screen reader meets it before any of its buttons. */
function describe(view: WidgetView): string {
  const scope = view.scopeLabel ? ` in ${view.scopeLabel}` : '';
  if (view.focus) return `Done Yet?: focusing on ${view.focus.title}, ${focusStatus(view.focus)}`;
  const [next] = view.rows;
  if (!next) return `Done Yet?: nothing waiting on you${scope}`;
  const count = view.openCount === 1 ? '1 task open' : `${view.openCount} tasks open`;
  return `Done Yet?: ${next.title}, ${next.dueLabel}, ${count}${scope}`;
}

/**
 * A session in progress takes the widget over: while one is running it is the only thing on the
 * home screen with a clock attached to it.
 *
 * It shows when the session ends rather than counting down, because it cannot count: Android
 * refreshes a widget every half hour at best, so a "4 min left" would be a lie within a minute
 * while an end time stays true until it passes. Tapping anywhere opens the app, which shows the
 * session itself (see application/MobileApp.tsx's FocusModal); Done is the one thing worth being
 * able to press without getting up.
 */
function Focus({ focus, tier }: { focus: WidgetFocus; tier: WidgetView['tier'] }) {
  if (tier === 'compact') {
    return (
      <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
        <TextWidget text={focus.title} style={{ color: colors.text, fontSize: 13, fontWeight: '700' }} maxLines={1} truncate="END" />
        <TextWidget text={focusStatus(focus)} style={{ color: colors.accent, fontSize: 11, fontWeight: '600', marginTop: 2 }} maxLines={1} truncate="END" />
      </FlexWidget>
    );
  }
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      <TextWidget text="ONE THING AT A TIME" style={{ color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1 }} maxLines={1} />
      <TextWidget text={focus.title} style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 }} maxLines={2} truncate="END" />
      <TextWidget text={focusStatus(focus)} style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600', marginTop: 2 }} maxLines={1} />
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginTop: 8 }}>
        <Chip label="✓ Done" accessibilityLabel={`Mark ${focus.title} done`} clickAction={CLICK_COMPLETE} clickActionData={{ taskId: focus.taskId }} emphasis />
      </FlexWidget>
    </FlexWidget>
  );
}

/** Reads true between refreshes, which a countdown would not. */
function focusStatus(focus: WidgetFocus): string {
  const minutes = Math.ceil(focus.remainingSeconds / 60);
  if (focus.paused) return `Paused · ${minutes} min left`;
  if (focus.remainingSeconds <= 0) return 'Time is up';
  return `Until ${new Date(focus.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** Nothing open. Still worth a way in, or the widget is just a dead rectangle. */
function Empty({ tier, scopeLabel }: { tier: WidgetView['tier']; scopeLabel: string | null }) {
  // A scoped widget has to say so, or an empty one reads as "you are done" when there is plenty
  // waiting outside the project it watches.
  const text = scopeLabel ? `Nothing left in ${scopeLabel}` : 'Nothing waiting on you';
  if (tier === 'compact') {
    return <TextWidget text={text} style={{ color: colors.textMuted, fontSize: 13, fontWeight: '600' }} maxLines={1} truncate="END" />;
  }
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      <TextWidget text={text} style={{ color: colors.text, fontSize: 14, fontWeight: '700' }} maxLines={2} truncate="END" />
      <Chip label="+ Add a task" accessibilityLabel="Add a task" uri={shortcutUrls.addTask} marginTop={10} />
    </FlexWidget>
  );
}

/** Too short for buttons: say what is next and how much there is, and open the app on a tap. */
function Compact({ view, next }: { view: WidgetView; next: WidgetRow }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: shortcutUrls.task(next.id) }}
      accessibilityLabel={`Open ${next.title}`}
      style={{ flexDirection: 'column', width: 'match_parent' }}
    >
      <TextWidget text={next.title} style={{ color: colors.text, fontSize: 13, fontWeight: '700' }} maxLines={1} truncate="END" />
      <TextWidget
        text={view.openCount === 1 ? next.dueLabel : `${next.dueLabel} · ${view.openCount} open`}
        style={{ color: next.overdue ? colors.warning : colors.accent, fontSize: 11, fontWeight: '600', marginTop: 2 }}
        maxLines={1}
        truncate="END"
      />
    </FlexWidget>
  );
}

/** The default: one task, with everything you can do to it. */
function Card({ view, next }: { view: WidgetView; next: WidgetRow }) {
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: shortcutUrls.task(next.id) }}
        accessibilityLabel={`Open ${next.title}`}
        style={{ flexDirection: 'column', width: 'match_parent' }}
      >
        <TextWidget text={next.title} style={{ color: colors.text, fontSize: 15, fontWeight: '700' }} maxLines={2} truncate="END" />
        <TextWidget text={next.dueLabel} style={{ color: next.overdue ? colors.warning : colors.accent, fontSize: 12, fontWeight: '600', marginTop: 2 }} />
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', marginTop: 8 }}>
        <Chip label="✓ Done" accessibilityLabel={`Mark ${next.title} done`} clickAction={CLICK_COMPLETE} clickActionData={{ taskId: next.id }} emphasis />
        <Chip label={`+${SNOOZE_MINUTES}m`} accessibilityLabel={`Snooze ${next.title} for ${SNOOZE_MINUTES} minutes`} clickAction={CLICK_SNOOZE} clickActionData={{ taskId: next.id }} marginLeft={6} />
        <Chip label="Focus" accessibilityLabel={`Start a focus session on ${next.title}`} uri={shortcutUrls.focus(next.id)} marginLeft={6} />
      </FlexWidget>
      <Footer view={view} marginTop={8} />
    </FlexWidget>
  );
}

/**
 * Tall enough to be worth a list. Each row opens its own task and carries its own Done — the
 * per-task Snooze and Focus stay on the card tier, because three buttons a row turns the list into
 * a control panel rather than something you can read at a glance.
 */
function List({ view }: { view: WidgetView }) {
  return (
    <FlexWidget style={{ flexDirection: 'column', width: 'match_parent' }}>
      <Footer view={view} />
      {view.rows.map(row => (
        <FlexWidget
          key={row.id}
          style={{ flexDirection: 'row', width: 'match_parent', alignItems: 'center', marginTop: 8 }}
        >
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: shortcutUrls.task(row.id) }}
            accessibilityLabel={`Open ${row.title}, ${row.dueLabel}`}
            style={{ flex: 1, flexDirection: 'column', paddingVertical: 2 }}
          >
            <TextWidget text={row.title} style={{ color: colors.text, fontSize: 14, fontWeight: '600' }} maxLines={1} truncate="END" />
            <TextWidget text={row.dueLabel} style={{ color: row.overdue ? colors.warning : colors.textMuted, fontSize: 11, marginTop: 1 }} maxLines={1} />
          </FlexWidget>
          <Chip label="✓" accessibilityLabel={`Mark ${row.title} done`} clickAction={CLICK_COMPLETE} clickActionData={{ taskId: row.id }} emphasis marginLeft={8} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** The open count on one side, a way to add on the other. Doubles as the list's header. */
function Footer({ view, marginTop = 0 }: { view: WidgetView; marginTop?: number }) {
  const open = view.openCount === 1 ? '1 task open' : `${view.openCount} tasks open`;
  const count = view.scopeLabel ? `${view.openCount} in ${view.scopeLabel}` : open;
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center', marginTop }}>
      <TextWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: shortcutUrls.tasks }}
        accessibilityLabel={`Open the task list, ${open}${view.scopeLabel ? ` in ${view.scopeLabel}` : ''}`}
        text={count}
        style={{ color: colors.textMuted, fontSize: 11 }}
      />
      <TextWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: shortcutUrls.addTask }}
        accessibilityLabel="Add a task"
        text="+ Add"
        style={{ color: colors.textMuted, fontSize: 11, fontWeight: '600' }}
      />
    </FlexWidget>
  );
}

/** A tap target that either opens one `doneyet://` link or raises one widget command. Its own
 * `FlexWidget` rather than a bare `TextWidget` so the padding is part of the touch area — a
 * text-sized target is too small to hit reliably on a home screen. */
function Chip({ label, accessibilityLabel, uri, clickAction, clickActionData, emphasis = false, marginTop = 0, marginLeft = 0 }: {
  label: string;
  accessibilityLabel: string;
  uri?: string;
  clickAction?: string;
  clickActionData?: Record<string, unknown>;
  emphasis?: boolean;
  marginTop?: number;
  marginLeft?: number;
}) {
  return (
    <FlexWidget
      clickAction={uri ? 'OPEN_URI' : clickAction}
      clickActionData={uri ? { uri } : clickActionData}
      accessibilityLabel={accessibilityLabel}
      style={{
        backgroundColor: emphasis ? colors.accent : colors.surfaceStrong,
        borderColor: emphasis ? colors.accent : colors.border,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginTop,
        marginLeft,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <TextWidget text={label} style={{ color: emphasis ? colors.background : colors.accent, fontSize: 12, fontWeight: '600' }} maxLines={1} />
    </FlexWidget>
  );
}
