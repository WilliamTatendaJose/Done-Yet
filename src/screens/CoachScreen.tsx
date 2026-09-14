import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getCoachingAdvice } from '../../../src/domain/engine';
import { badges, type Badge } from '../../../src/domain/badges';
import {
  completionStats,
  completionStreak,
  procrastinationStats,
  reminderEffectiveness,
  type ReminderEffectiveness,
} from '../../../src/domain/insights';
import type { Blocker, Personality, Project, Task } from '../../../src/domain/types';
import type { AiAssistState } from '../cloud/useAiAssist';
import { Button, Choice } from '../components/ui';
import { colors, radii, spacing } from '../theme';

const blockers: ReadonlyArray<{ id: Blocker; label: string }> = [
  { id: 'start', label: 'Where do I start?' },
  { id: 'overwhelmed', label: 'It feels too big' },
  { id: 'waiting', label: 'Waiting on someone' },
  { id: 'time', label: 'Not enough time' },
];

interface Props {
  personality: Personality;
  nextTask?: Task;
  tasks: Task[];
  projects: Project[];
  /** Open (not-yet-done) tasks, used only to build the minimised daily-plan request — see domain/aiPayload.ts's buildPayload, which reads just each task's title and dueAt. */
  openTasks: Task[];
  now: number;
  defaultFocusMinutes: number;
  onStartFocus: (id: string) => void;
  onAddTask: () => void;
  ai: AiAssistState;
}

/** Local hour (0-23) as a friendly "3pm" style label. */
function hourLabel(hour: number) {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function commonestHourNote(hour: number | null): string | null {
  return hour === null ? null : `You tend to finish tasks around ${hourLabel(hour)}.`;
}

function delayNote(medianDelayMs: number | null): string | null {
  if (medianDelayMs === null) return null;
  const hours = Math.round(Math.abs(medianDelayMs) / 3600000);
  if (hours < 1) return 'Tasks are typically finished right around their deadline.';
  const span = hours < 48 ? `${hours}h` : `${Math.round(hours / 24)} days`;
  return medianDelayMs > 0
    ? `Tasks are typically finished about ${span} after their deadline.`
    : `Tasks are typically finished about ${span} before their deadline.`;
}

function reminderNote(effectiveness: ReminderEffectiveness): string | null {
  if (effectiveness.delivered === 0) return null;
  const percent = Math.round((effectiveness.completedAfterReminder / effectiveness.delivered) * 100);
  return `${percent}% of reminders were followed by getting the task done.`;
}

export function CoachScreen({ personality, nextTask, tasks, projects, openTasks, now, defaultFocusMinutes, onStartFocus, onAddTask, ai }: Props) {
  const [blocker, setBlocker] = useState<Blocker>('start');
  const advice = getCoachingAdvice(blocker, personality);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState('');
  const [plan, setPlan] = useState('');

  function planTodayWithAi() {
    const payload = ai.prepare('daily-plan', openTasks, new Date(now));
    if (!payload) { setPlanError('Add a task with a title first.'); return; }
    setPlanError(''); setPlan('');
    Alert.alert('Send to AI?', ai.describe(payload), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => void runPlanToday() },
    ]);
  }

  async function runPlanToday() {
    const payload = ai.prepare('daily-plan', openTasks, new Date(now));
    if (!payload) return;
    setPlanBusy(true); setPlanError(''); setPlan('');
    const result = await ai.send(payload);
    setPlanBusy(false);
    if (result.status !== 'success') { setPlanError(result.message); return; }
    setPlan(result.value.text);
  }

  const nowDate = useMemo(() => new Date(now), [now]);
  const streak = useMemo(() => completionStreak(tasks, nowDate), [tasks, nowDate]);
  const stats = useMemo(() => completionStats(tasks, nowDate), [tasks, nowDate]);
  const procrastination = useMemo(() => procrastinationStats(tasks), [tasks]);
  const reminderStats = useMemo(() => reminderEffectiveness(tasks, nowDate), [tasks, nowDate]);
  const badgeList = useMemo(() => badges(tasks, projects, nowDate), [tasks, projects, nowDate]);
  const hasHistory = stats.completed > 0;

  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>ON-DEVICE COACHING</Text>
    <Text style={styles.hero}>What’s in the way?</Text>
    <Text style={styles.body}>Let’s make the next step smaller.</Text>
    <View style={styles.wrap}>{blockers.map(item => <Choice key={item.id} label={item.label} selected={blocker === item.id} onPress={() => setBlocker(item.id)} />)}</View>
    <View style={styles.card}>
      <Ionicons name="sparkles-outline" color={colors.accent} size={28} />
      <Text style={styles.cardTitle}>{advice.title}</Text>
      <Text style={styles.body}>{advice.body}</Text>
      <Text style={styles.taskTitle}>{advice.nextStep}</Text>
      <Button label={nextTask ? `Try a ${defaultFocusMinutes}-minute session` : 'Add your first step'} onPress={() => nextTask ? onStartFocus(nextTask.id) : onAddTask()} />
    </View>
    <Text style={styles.caption}>
      {ai.available
        ? "These suggestions are built in and never leave this device. AI assistance below is on: tapping “Plan today” sends only your open tasks' titles and due times, and only after you confirm."
        : `These suggestions are built in and never leave this device. ${ai.unavailableReason}`}
    </Text>
    {openTasks.length > 0 ? <View style={styles.card}>
      <Ionicons name="sparkles-outline" color={colors.accent} size={28} />
      <Text style={styles.cardTitle}>Plan today</Text>
      <Text style={styles.body}>Sends only your open tasks' titles and due times to suggest a realistic order — nothing else about them, and only once you confirm.</Text>
      <Button quiet disabled={!ai.available || planBusy} label={planBusy ? 'Asking AI…' : 'Plan today with AI'} onPress={planTodayWithAi} />
      {!ai.available ? <Text style={styles.caption}>{ai.unavailableReason}</Text> : null}
      {planError ? <Text style={styles.error}>{planError}</Text> : null}
      {plan ? <Text style={styles.body}>{plan}</Text> : null}
    </View> : null}

    <View style={styles.sectionHead}><Text style={styles.eyebrow}>YOUR PATTERNS</Text></View>
    {!hasHistory ? (
      <View style={styles.card}>
        <Ionicons name="leaf-outline" color={colors.accent} size={28} />
        <Text style={styles.body}>Nothing finished yet. Once you complete a task, your streak, badges and patterns will start showing up here.</Text>
      </View>
    ) : <>
      <View style={styles.statRow}>
        <StatTile label="Current streak" value={streak.current === 0 ? '—' : `${streak.current}d`} />
        <StatTile label="Longest streak" value={`${streak.longest}d`} />
        <StatTile label="Completed" value={`${stats.completed}`} />
        <StatTile label="Completion rate" value={`${stats.completionRate}%`} />
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Badges</Text>
        {badgeList.map(badge => <BadgeRow key={badge.id} badge={badge} />)}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Worth noticing</Text>
        {commonestHourNote(procrastination.commonestHour) ? <Text style={styles.body}>{commonestHourNote(procrastination.commonestHour)}</Text> : null}
        {delayNote(procrastination.medianDelayMs) ? <Text style={styles.body}>{delayNote(procrastination.medianDelayMs)}</Text> : null}
        {procrastination.tasksNeverSnoozed > 0 ? <Text style={styles.body}>{procrastination.tasksNeverSnoozed} task{procrastination.tasksNeverSnoozed === 1 ? '' : 's'} finished without ever being snoozed.</Text> : null}
        {reminderNote(reminderStats) ? <Text style={styles.body}>{reminderNote(reminderStats)}</Text> : null}
        <Text style={styles.caption}>Just observations, never a scorecard — there’s no “good” or “bad” number here.</Text>
      </View>
    </>}
  </ScrollView>;
}

function StatTile({ label, value }: { label: string; value: string }) {
  return <View style={styles.statTile}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.caption}>{label}</Text>
  </View>;
}

function BadgeRow({ badge }: { badge: Badge }) {
  return <View style={styles.badgeRow}>
    <Ionicons name={badge.earned ? 'ribbon' : 'ribbon-outline'} color={badge.earned ? colors.accent : colors.textMuted} size={22} />
    <View style={styles.badgeCopy}>
      <Text style={styles.badgeTitle}>{badge.title}</Text>
      <Text style={styles.caption}>{badge.description}</Text>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${badge.title} progress`}
        accessibilityValue={{ min: 0, max: 100, now: badge.progress }}
        style={styles.track}
      >
        <View style={[styles.fill, { width: `${badge.progress}%` }]} />
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  eyebrow: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  hero: { color: colors.text, fontSize: 35, lineHeight: 41, fontWeight: '700', letterSpacing: -1.3 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  error: { color: colors.errorText, fontSize: 12, lineHeight: 18 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: 20, gap: spacing.md, marginTop: 10 },
  cardTitle: { color: colors.text, fontSize: 23, lineHeight: 30, fontWeight: '600', letterSpacing: -0.5 },
  taskTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xs },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statTile: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, gap: 2 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  badgeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  badgeCopy: { flex: 1, gap: 6 },
  badgeTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  track: { height: 6, borderRadius: 6, overflow: 'hidden', backgroundColor: '#364030' },
  fill: { height: 6, backgroundColor: colors.accent },
});
