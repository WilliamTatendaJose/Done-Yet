import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { allTags, normalizeTags } from '../../../../src/domain/tags';
import type { Task } from '../../../../src/domain/types';
import { Choice, Field } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  value: string[];
  /** Every task in the list, used only to surface previously-used tags as suggestions. */
  tasks: Task[];
  onChange: (tags: string[]) => void;
}

export function TagFields({ value, tasks, onChange }: Props) {
  const [text, setText] = useState('');

  function commit() {
    if (!text.trim()) return;
    onChange(normalizeTags([...value, text]));
    setText('');
  }

  const suggestions = allTags(tasks)
    .filter(tag => !value.some(v => v.toLowerCase() === tag.toLowerCase()))
    .slice(0, 8);

  return (
    <Field label="Tags">
      {value.length ? (
        <View style={styles.wrap}>
          {value.map(tag => (
            <Pressable
              key={tag}
              onPress={() => onChange(value.filter(t => t !== tag))}
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
              style={({ pressed }) => [styles.chip, pressed && styles.dimmed]}
            >
              <Text style={styles.chipText}>{tag}</Text>
              <Ionicons name="close" size={13} color={colors.accent} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Add a tag"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Add a tag"
          placeholderTextColor={colors.textMuted}
          onSubmitEditing={commit}
          returnKeyType="done"
        />
        <Pressable onPress={commit} accessibilityRole="button" accessibilityLabel="Add tag" style={({ pressed }) => [styles.addButton, pressed && styles.dimmed]}>
          <Ionicons name="add" size={20} color={colors.background} />
        </Pressable>
      </View>
      {suggestions.length ? (
        <View style={styles.wrap}>
          {suggestions.map(tag => <Choice key={tag} label={tag} selected={false} onPress={() => onChange(normalizeTags([...value, tag]))} />)}
        </View>
      ) : null}
    </Field>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 14, color: colors.text, fontSize: 16, minHeight: 50 },
  addButton: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  dimmed: { opacity: 0.6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.round, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.text, fontSize: 13 },
});
