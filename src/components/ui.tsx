import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radii, spacing } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

interface ButtonProps {
  label: string;
  onPress: () => void | Promise<void>;
  quiet?: boolean;
  icon?: IconName;
  disabled?: boolean;
}

export function Button({ label, onPress, quiet = false, icon, disabled = false }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { void onPress(); }}
      style={({ pressed }) => [styles.button, quiet ? styles.quietButton : styles.primaryButton, (pressed || disabled) && styles.dimmed]}
    >
      {icon ? <Ionicons name={icon} size={19} color={quiet ? colors.accent : colors.background} /> : null}
      <Text style={[styles.buttonText, { color: quiet ? colors.accent : colors.background }]}>{label}</Text>
    </Pressable>
  );
}

interface IconButtonProps {
  name: IconName;
  label: string;
  onPress: () => void | Promise<void>;
  color?: string;
}

export function IconButton({ name, label, onPress, color = colors.text }: IconButtonProps) {
  return (
    <Pressable
      onPress={() => { void onPress(); }}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.dimmed]}
    >
      <Ionicons name={name} color={color} size={23} />
    </Pressable>
  );
}

interface ChoiceProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function Choice({ label, selected, onPress }: ChoiceProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.dimmed]}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.sm,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: { backgroundColor: colors.accent },
  quietButton: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  dimmed: { opacity: 0.6 },
  iconButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  choice: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    padding: spacing.md,
    justifyContent: 'center',
  },
  choiceSelected: { backgroundColor: '#293620', borderColor: '#72944F' },
  choiceText: { color: colors.textMuted, fontSize: 13 },
  choiceTextSelected: { color: colors.accent },
  field: { gap: 10, marginVertical: spacing.sm },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
