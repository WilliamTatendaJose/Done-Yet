import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../../../../src/domain/types';
import { describeRecurrence } from '../../../../src/domain/recurrence';
import { IconButton } from '../../components/ui';
import { colors, spacing } from '../../theme';

interface Props {
  task: Task;
  onEdit: (task: Task) => void;
  onToggle: (id: string) => void;
  onStartFocus: (id: string) => void;
}

export function TaskRow({ task, onEdit, onToggle, onStartFocus }: Props) {
  const done = task.status === 'done';
  const repeat = describeRecurrence(task.recurrence);
  const subtasks = task.subtasks;
  const steps = subtasks?.length ? `${subtasks.filter(s => s.done).length}/${subtasks.length} steps` : '';
  const attachmentCount = task.attachments?.length ?? 0;
  return <View style={styles.row}>
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={`${done ? 'Reopen' : 'Complete'} ${task.title}`}
      hitSlop={8}
      style={styles.checkButton}
      onPress={() => onToggle(task.id)}
    >
      <Ionicons name={done ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={done ? colors.accent : colors.textMuted} />
    </Pressable>
    <Pressable onPress={() => onEdit(task)} style={styles.copy} accessibilityRole="button" accessibilityLabel={`Edit ${task.title}`}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, done && styles.done]}>{task.title}</Text>
        {repeat ? <Ionicons name="repeat" size={15} color={colors.textMuted} accessibilityLabel={repeat} /> : null}
      </View>
      <View style={styles.captionRow}>
        <Text style={styles.caption}>{task.dueAt ? new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No deadline'}{task.reminderMode === 'annoy' ? ` · ${task.reminderLevel}` : ''}{repeat ? ` · ${repeat.toLowerCase()}` : ''}{steps ? ` · ${steps}` : ''}</Text>
        {attachmentCount ? <View style={styles.attachmentBadge}>
          <Ionicons name="attach-outline" size={13} color={colors.textMuted} accessibilityLabel={`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`} />
          <Text style={styles.caption}>{attachmentCount}</Text>
        </View> : null}
      </View>
      {task.tags?.length ? <View style={styles.tagRow}>{task.tags.map(tag => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>)}</View> : null}
    </Pressable>
    {!done ? <IconButton name="play-outline" label={`Focus on ${task.title}`} onPress={() => onStartFocus(task.id)} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  checkButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  copy: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  attachmentBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22, flexShrink: 1 },
  done: { textDecorationLine: 'line-through', color: colors.textMuted },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  tag: { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { color: colors.textMuted, fontSize: 11 },
});
