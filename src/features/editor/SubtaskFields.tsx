import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import type { Subtask } from '../../../../src/domain/types';
import { Field, IconButton } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  value: Subtask[];
  onChange: (subtasks: Subtask[]) => void;
}

const MAX_SUBTASKS = 20;
const MAX_TITLE = 120;

export function SubtaskFields({ value, onChange }: Props) {
  const [text, setText] = useState('');
  const atCap = value.length >= MAX_SUBTASKS;

  function add() {
    const title = text.trim();
    if (!title || title.length > MAX_TITLE || atCap) return;
    onChange([...value, { id: randomUUID(), title, done: false }]);
    setText('');
  }

  return (
    <Field label="Steps">
      {value.map(step => (
        <View key={step.id} style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: step.done }}
            accessibilityLabel={`${step.done ? 'Mark step undone' : 'Mark step done'}: ${step.title}`}
            hitSlop={8}
            onPress={() => onChange(value.map(s => s.id === step.id ? { ...s, done: !s.done } : s))}
          >
            <Ionicons name={step.done ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={step.done ? colors.accent : colors.textMuted} />
          </Pressable>
          <TextInput
            accessibilityLabel={`Step title, ${step.title}`}
            style={[styles.input, step.done && styles.done]}
            value={step.title}
            maxLength={MAX_TITLE}
            onChangeText={title => onChange(value.map(s => s.id === step.id ? { ...s, title } : s))}
          />
          <IconButton name="close" label={`Remove step ${step.title}`} onPress={() => onChange(value.filter(s => s.id !== step.id))} />
        </View>
      ))}
      {!atCap ? (
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Add a step"
            style={[styles.input, styles.flex]}
            value={text}
            maxLength={MAX_TITLE}
            onChangeText={setText}
            placeholder="Add a step"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={add}
            returnKeyType="done"
          />
          <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add step" style={({ pressed }) => [styles.addButton, pressed && styles.dimmed]}>
            <Ionicons name="add" size={20} color={colors.background} />
          </Pressable>
        </View>
      ) : <Text style={styles.caption}>Limit of {MAX_SUBTASKS} steps reached</Text>}
    </Field>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 14, color: colors.text, fontSize: 15, minHeight: 46 },
  done: { textDecorationLine: 'line-through', color: colors.textMuted },
  addButton: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  dimmed: { opacity: 0.6 },
  caption: { color: colors.textMuted, fontSize: 12 },
});
