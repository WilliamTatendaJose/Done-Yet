import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { randomUUID } from 'expo-crypto';
import type { Milestone } from '../../../../src/domain/types';
import { Button, Field, IconButton } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  value: Milestone[];
  onChange: (milestones: Milestone[]) => void;
}

const MAX_MILESTONES = 20;
const MAX_TITLE = 120;

export function MilestoneFields({ value, onChange }: Props) {
  const [text, setText] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const atCap = value.length >= MAX_MILESTONES;

  function add() {
    const title = text.trim();
    if (!title || title.length > MAX_TITLE || atCap) return;
    onChange([...value, { id: randomUUID(), title, targetAt: null, done: false }]);
    setText('');
  }

  return (
    <Field label="Milestones">
      {value.map(milestone => (
        <View key={milestone.id} style={styles.item}>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: milestone.done }}
              accessibilityLabel={`${milestone.done ? 'Mark milestone undone' : 'Mark milestone done'}: ${milestone.title}`}
              hitSlop={8}
              onPress={() => onChange(value.map(m => m.id === milestone.id ? { ...m, done: !m.done } : m))}
            >
              <Ionicons name={milestone.done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={milestone.done ? colors.accent : colors.textMuted} />
            </Pressable>
            <TextInput
              accessibilityLabel={`Milestone title, ${milestone.title}`}
              style={[styles.input, milestone.done && styles.done]}
              value={milestone.title}
              maxLength={MAX_TITLE}
              onChangeText={title => onChange(value.map(m => m.id === milestone.id ? { ...m, title } : m))}
            />
            <IconButton name="close" label={`Remove milestone ${milestone.title}`} onPress={() => onChange(value.filter(m => m.id !== milestone.id))} />
          </View>
          <View style={styles.row}>
            <Button
              quiet
              icon="calendar-outline"
              label={milestone.targetAt ? `Target ${new Date(milestone.targetAt).toLocaleDateString()}` : 'Set target date'}
              onPress={() => setPickerFor(milestone.id)}
            />
            {milestone.targetAt ? (
              <IconButton name="close-circle-outline" label={`Clear target date for ${milestone.title}`} onPress={() => onChange(value.map(m => m.id === milestone.id ? { ...m, targetAt: null } : m))} />
            ) : null}
          </View>
          {pickerFor === milestone.id ? (
            <DateTimePicker
              value={milestone.targetAt ? new Date(milestone.targetAt) : new Date()}
              mode="date"
              themeVariant="dark"
              onChange={(_, selected) => {
                if (Platform.OS === 'android') setPickerFor(null);
                if (selected) onChange(value.map(m => m.id === milestone.id ? { ...m, targetAt: selected.toISOString() } : m));
              }}
            />
          ) : null}
        </View>
      ))}
      {!atCap ? (
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Add a milestone"
            style={[styles.input, styles.flex]}
            value={text}
            maxLength={MAX_TITLE}
            onChangeText={setText}
            placeholder="Add a milestone"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add milestone" style={({ pressed }) => [styles.addButton, pressed && styles.dimmed]}>
            <Ionicons name="add" size={20} color={colors.background} />
          </Pressable>
        </View>
      ) : <Text style={styles.caption}>Limit of {MAX_MILESTONES} milestones reached</Text>}
    </Field>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 14, color: colors.text, fontSize: 15, minHeight: 46 },
  done: { textDecorationLine: 'line-through', color: colors.textMuted },
  addButton: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  dimmed: { opacity: 0.6 },
  caption: { color: colors.textMuted, fontSize: 12 },
});
