import { useEffect, useMemo, useState, useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Project, Task } from '../../../src/domain/types';
import { useMobileStore } from '../state/useMobileStore';
import { useNotifications } from '../notifications/useNotifications';
import { useCalendarSync } from '../features/calendar/useCalendarSync';
import { useShortcutLink } from '../features/shortcuts/useShortcutLink';
import { useQuickActions } from '../features/shortcuts/useQuickActions';
import { updateWidget } from '../features/widget/updateWidget';
import { useAppClock } from '../hooks/useAppClock';
import { useInAppReminder } from '../features/reminders/useInAppReminder';
import { useEscalationSuggestions } from '../features/escalation/useEscalationSuggestions';
import { useCloudSync } from '../cloud/useCloudSync';
import { useAiAssist } from '../cloud/useAiAssist';
import { InAppReminder } from '../features/reminders/InAppReminder';
import { EntityEditorModal, type EditorSelection } from '../features/editor/EntityEditorModal';
import { FocusModal } from '../features/focus/FocusModal';
import { Confetti } from '../features/celebrate/Confetti';
import { useCompletionCelebration } from '../features/celebrate/useCompletionCelebration';
import { RecoveryActions } from '../components/RecoveryActions';
import { Button, IconButton } from '../components/ui';
import { AppTabBar } from '../navigation/AppTabBar';
import type { TabName } from '../navigation';
import { TodayScreen } from '../screens/TodayScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { ProjectsScreen } from '../screens/ProjectsScreen';
import { CoachScreen } from '../screens/CoachScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors, spacing } from '../theme';
import { useRevenueCat } from '../cloud/revenueCat';
import type { ProAccess } from '../cloud/subscriptionPolicy';

const priorityRank: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

export function MobileApp() {
  const { state, error, saving, dispatch, retry, importSnapshot, replaceRemote } = useMobileStore();
  const [tab, setTab] = useState<TabName>('Today');
  const [editor, setEditor] = useState<EditorSelection>(null);
  const now = useAppClock(30_000);
  const [proAccess, setProAccess] = useState<ProAccess>({ resolving: true, isPro: false });
  const notifications = useNotifications(state, dispatch, () => setTab('Projects'), () => setTab('Coach'));
  const calendarSync = useCalendarSync(state, dispatch);
  const cloud = useCloudSync(state, dispatch, replaceRemote, proAccess);
  const billing = useRevenueCat(cloud.userId ?? undefined);
  useEffect(() => { const next = { resolving: billing.state.resolving, isPro: billing.state.isPro }; setProAccess(prev => prev.resolving === next.resolving && prev.isPro === next.isPro ? prev : next); }, [billing.state.resolving, billing.state.isPro]);
  const ai = useAiAssist(state, cloud.signedIn, proAccess, cloud.token);
  const escalationSuggestions = useEscalationSuggestions(state, now, dispatch);
  const openTasks = useMemo(() => state?.tasks.filter(task => task.status === 'todo') ?? [], [state?.tasks]);
  const completedTasks = useMemo(() => state?.tasks.filter(task => task.status === 'done') ?? [], [state?.tasks]);
  const orderedTasks = useMemo(() => [...openTasks].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || Date.parse(a.dueAt ?? '9999-01-01') - Date.parse(b.dueAt ?? '9999-01-01')), [openTasks]);
  const inAppReminder = useInAppReminder({
    state,
    now,
    editorOpen: editor !== null,
    backgroundDeliveryAvailable: notifications.status === 'available' && notifications.count > 0,
    dispatch,
  });
  const { celebration, clear: clearCelebration } = useCompletionCelebration(state, now);

  // Widget data must reflect the persisted snapshot as soon as it changes, on app start included —
  // not only while the app is in the foreground. This covers "in the foreground"; the widget's own
  // headless task handler (registerWidgetTaskHandler) covers the OS's periodic background refresh.
  useEffect(() => { if (state) void updateWidget(state); }, [state]);

  // One handler for all three routes into the same two actions: a long-press launcher shortcut,
  // an Assistant intent built on it, and a plain `doneyet://` link.
  //
  // A cold start delivers the action before SQLite has loaded, so "focus" cannot pick a task yet.
  // Park it and run it once tasks exist, otherwise the shortcut silently does nothing — which is
  // exactly how it failed on device before this was added.
  const [pendingShortcut, setPendingShortcut] = useState<'add-task' | 'focus' | null>(null);
  const runShortcut = useCallback((action: 'add-task' | 'focus') => {
    if (action === 'add-task') { setEditor({ kind: 'task' }); return; }
    setPendingShortcut('focus');
  }, []);
  useShortcutLink(runShortcut);
  useQuickActions(runShortcut);
  useEffect(() => {
    if (pendingShortcut !== 'focus' || !state) return;
    const target = orderedTasks[0];
    setPendingShortcut(null);
    if (target) void dispatch({ type: 'startFocus', id: target.id });
  }, [pendingShortcut, state, orderedTasks, dispatch]);

  if (!state) return <LoadingState error={error} retry={retry} restore={importSnapshot} />;

  const nextTask = orderedTasks[0];
  const focusTask = state.tasks.find(task => task.id === state.focus?.taskId);

  const openTaskEditor = (task?: Task) => setEditor({ kind: 'task', task });
  const openProjectEditor = (project?: Project) => setEditor({ kind: 'project', project });
  const run = (action: Parameters<typeof dispatch>[0]) => { void dispatch(action); };

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <StatusBar style="light" />
    <View style={styles.header}>
      <Text style={styles.brand}>done yet<Text style={styles.brandAccent}>?</Text></Text>
      <View style={styles.headerActions}>
        <Text style={styles.storageStatus}>{saving ? 'Saving…' : 'On this device'}</Text>
        <IconButton
          name="add"
          label={tab === 'Projects' ? 'Add project' : 'Add task'}
          onPress={() => tab === 'Projects' ? openProjectEditor() : openTaskEditor()}
        />
      </View>
    </View>
    {error || notifications.error || calendarSync.error ? <View style={styles.banner}><Text accessibilityRole="alert" style={styles.error}>{error || notifications.error || calendarSync.error}</Text></View> : null}
    {inAppReminder.reminder ? <View style={styles.banner}><InAppReminder task={inAppReminder.reminder} dispatch={dispatch} onDismiss={inAppReminder.dismiss} /></View> : null}
    <View style={styles.content}>
      {tab === 'Today' ? <TodayScreen
        now={now}
        tasks={orderedTasks}
        completed={completedTasks}
        nextTask={nextTask}
        defaultFocusMinutes={state.settings.focusMinutes ?? 5}
        onEditTask={openTaskEditor}
        onCompleteTask={id => run({ type: 'completeTask', id })}
        onToggleTask={id => run({ type: 'toggleTask', id })}
        onStartFocus={(id, minutes) => run({ type: 'startFocus', id, minutes })}
        onAddTask={() => openTaskEditor()}
        onOpenCoach={() => setTab('Coach')}
      /> : null}
      {tab === 'Tasks' ? <TasksScreen
        now={now}
        tasks={state.tasks}
        onEditTask={openTaskEditor}
        onToggleTask={id => run({ type: 'toggleTask', id })}
        onStartFocus={id => run({ type: 'startFocus', id })}
      /> : null}
      {tab === 'Projects' ? <ProjectsScreen
        projects={state.projects}
        now={now}
        onEditProject={openProjectEditor}
        onProgressChange={(id, progress) => run({ type: 'progress', id, progress })}
        onAddProject={() => openProjectEditor()}
        ai={ai}
      /> : null}
      {tab === 'Coach' ? <CoachScreen
        personality={state.settings.personality}
        nextTask={nextTask}
        tasks={state.tasks}
        projects={state.projects}
        openTasks={openTasks}
        now={now}
        defaultFocusMinutes={state.settings.focusMinutes ?? 5}
        onStartFocus={id => run({ type: 'startFocus', id })}
        onAddTask={() => openTaskEditor()}
        ai={ai}
      /> : null}
      {tab === 'Settings' ? <SettingsScreen
        state={state}
        saving={saving}
        notificationCount={notifications.count}
        onSettingsChange={input => dispatch({ type: 'settings', input })}
        onImportSnapshot={importSnapshot}
        cloud={cloud}
        escalationSuggestions={escalationSuggestions}
        onApplyEscalation={(id, level) => run({ type: 'applyEscalation', id, level })}
        billing={billing}
      /> : null}
    </View>
    <AppTabBar selected={tab} onSelect={setTab} />
    <EntityEditorModal
      selection={editor}
      state={state}
      saving={saving}
      error={error}
      now={now}
      dispatch={dispatch}
      onClose={() => setEditor(null)}
      attachmentSync={{ enqueueUpload: cloud.enqueueAttachmentUpload, enqueueDelete: cloud.enqueueAttachmentDelete, download: cloud.downloadAttachment }}
      ai={ai}
      isPro={billing.state.isPro}
    />
    <FocusModal session={state.focus} task={focusTask} error={error} dispatch={dispatch} navigate={setTab} />
    {celebration ? <Confetti variant={celebration.variant} message={celebration.badge?.title} onDone={clearCelebration} /> : null}
  </SafeAreaView>;
}

function LoadingState({ error, retry, restore }: { error: string; retry: () => Promise<void>; restore: (raw: string) => Promise<boolean> }) {
  return <SafeAreaView style={[styles.screen, styles.loading]}>
    <StatusBar style="light" />
    {error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button label="Retry" onPress={retry} /><RecoveryActions restore={restore} /></> : <><ActivityIndicator color={colors.accent} /><Text style={styles.body}>Getting your next step ready…</Text></>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  loading: { justifyContent: 'center', alignItems: 'center', padding: spacing.xxl, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brand: { color: colors.text, fontSize: 25, fontWeight: '800', letterSpacing: -1 },
  brandAccent: { color: colors.accent },
  storageStatus: { color: colors.textMuted, fontSize: 10 },
  banner: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  error: { color: colors.errorText, padding: 14, backgroundColor: colors.errorSurface, borderRadius: 12 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
});
