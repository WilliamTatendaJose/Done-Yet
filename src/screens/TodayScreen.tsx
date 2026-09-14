import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../../../src/domain/types';
import { Button } from '../components/ui';
import { FocusDurationChips } from '../features/focus/FocusDurationChips';
import { TaskRow } from '../features/tasks/TaskRow';
import { colors, spacing } from '../theme';

interface Props {
  now: number;
  tasks: Task[];
  completed: Task[];
  nextTask?: Task;
  /** settings.focusMinutes ?? 5 — kept as a prop so the default-path button always reflects the
   * user's chosen default without this screen re-deriving it from raw settings. */
  defaultFocusMinutes: number;
  onEditTask: (task: Task) => void;
  onCompleteTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onStartFocus: (id: string, minutes?: number) => void;
  onAddTask: () => void;
  onOpenCoach: () => void;
}

type Row = { kind: 'task'; task: Task } | { kind: 'completed-toggle' };

export function TodayScreen(props: Props) {
  const { now, tasks, completed, nextTask } = props;
  const [showDone, setShowDone] = useState(false);
  const rows = useMemo<Row[]>(() => [
    ...tasks.map(task => ({ kind: 'task' as const, task })),
    ...(completed.length ? [{ kind: 'completed-toggle' as const }] : []),
    ...(showDone ? completed.map(task => ({ kind: 'task' as const, task })) : []),
  ], [completed, showDone, tasks]);

  return <FlatList
    data={rows}
    keyExtractor={row => row.kind === 'task' ? row.task.id : 'completed-toggle'}
    contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<>
      <Text style={styles.eyebrow}>{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()}</Text>
      <Text style={styles.hero}>A little start.{"\n"}A lot of momentum.</Text>
      <Text style={styles.body}>You don’t have to do it all. Just the next thing.</Text>
      <View style={styles.focusCard}>
        <View style={styles.between}><Text style={styles.accentLabel}>{nextTask ? 'YOUR NEXT MOVE' : 'ROOM TO BREATHE'}</Text><Ionicons name={nextTask ? 'arrow-forward' : 'checkmark-circle-outline'} color={colors.accent} size={22} /></View>
        <Text style={styles.cardTitle}>{nextTask?.title ?? 'Nothing waiting on you.'}</Text>
        <Text style={styles.body}>{nextTask?.notes || (nextTask ? 'A small block is a good place to start.' : 'Enjoy the space, or add your next intention.')}</Text>
        {/* One tap for the default length — a user who just wants to start never has to choose. */}
        <Button icon={nextTask ? 'play' : 'add'} label={nextTask ? `Start for ${props.defaultFocusMinutes} minutes` : 'Add a task'} onPress={() => nextTask ? props.onStartFocus(nextTask.id) : props.onAddTask()} />
        {/* Optional: pick a different length instead. Still one tap for a preset. */}
        {nextTask ? <FocusDurationChips onSelect={minutes => props.onStartFocus(nextTask.id, minutes)} /> : null}
        {nextTask ? <View style={styles.between}><Button quiet label="I’m blocked" onPress={props.onOpenCoach} /><Button quiet label="Mark done" onPress={() => props.onCompleteTask(nextTask.id)} /></View> : null}
      </View>
      <View style={styles.sectionHead}><Text style={styles.eyebrow}>ON YOUR RADAR</Text><Text style={styles.caption}>{tasks.length} open</Text></View>
    </>}
    renderItem={({ item }) => item.kind === 'completed-toggle'
      ? <Button quiet label={`${showDone ? 'Hide' : 'Show'} ${completed.length} finished`} onPress={() => setShowDone(value => !value)} />
      : <TaskRow task={item.task} onEdit={props.onEditTask} onToggle={props.onToggleTask} onStartFocus={props.onStartFocus} />}
  />;
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  eyebrow: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  hero: { color: colors.text, fontSize: 35, lineHeight: 41, fontWeight: '700', letterSpacing: -1.3 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  focusCard: { backgroundColor: colors.surfaceStrong, borderColor: '#475A35', borderWidth: 1, borderRadius: 24, padding: 21, marginTop: spacing.md, gap: 13 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  accentLabel: { color: colors.accent, fontSize: 11, letterSpacing: 1.2, fontWeight: '700', flexShrink: 1 },
  cardTitle: { color: colors.text, fontSize: 23, lineHeight: 30, fontWeight: '600', letterSpacing: -0.5 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xs },
});
