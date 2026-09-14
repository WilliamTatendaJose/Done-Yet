import { StyleSheet, Text, View } from 'react-native';
import type { Task } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';
import { Button } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  task: Task;
  dispatch: (action: Action) => Promise<boolean>;
  onDismiss: () => void;
}

export function InAppReminder({ task, dispatch, onDismiss }: Props) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{task.title}</Text>
      <Text style={styles.caption}>Ready for one small step?</Text>
      <View style={styles.actions}>
        <Button quiet label="Snooze 15m" onPress={async () => {
          if (await dispatch({ type: 'snoozeTask', id: task.id, minutes: 15 })) onDismiss();
        }} />
        <Button quiet label="Done" onPress={async () => {
          if (await dispatch({ type: 'completeTask', id: task.id })) onDismiss();
        }} />
        <Button quiet label="Dismiss" onPress={() => { void dispatch({ type: 'recordEngagement', id: task.id, kind: 'dismissed' }); onDismiss(); }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#302B1B',
    borderColor: '#72613D',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
