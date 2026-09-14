import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { decodeState } from '../../../src/state/storage';
import { pickBackup } from '../state/backup';
import { readMetadata } from '../state/database';
import { colors, radii, spacing } from '../theme';

interface Props { restore: (raw: string) => Promise<boolean> }

const options = [
  { label: 'Restore previous save', previous: true },
  { label: 'Import a backup', previous: false },
] as const;

export function RecoveryActions({ restore }: Props) {
  const [busy, setBusy] = useState(false);

  async function recover(previous: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const raw = previous ? await readMetadata('previous_snapshot') : await pickBackup();
      if (!raw) {
        if (previous) Alert.alert('No previous save available', 'Try importing a backup instead.');
        return;
      }
      decodeState(raw);
      Alert.alert('Restore saved data?', 'This replaces the unreadable snapshot. Background reminders will remain off until you enable them again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', onPress: () => { void restore(raw); } },
      ]);
    } catch {
      Alert.alert('Could not restore this data', 'The selected snapshot is not a valid Done Yet? backup. Your existing data has not been changed.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.container}>{options.map(option => <Pressable
    key={option.label}
    disabled={busy}
    accessibilityRole="button"
    accessibilityState={{ disabled: busy }}
    onPress={() => { void recover(option.previous); }}
    style={({ pressed }) => [styles.button, (pressed || busy) && styles.pressed]}
  ><Text style={styles.label}>{option.label}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  button: { minHeight: 48, padding: 14, borderRadius: radii.sm, backgroundColor: colors.surfaceStrong },
  label: { color: colors.accent, fontWeight: '600' },
  pressed: { opacity: 0.55 },
});
