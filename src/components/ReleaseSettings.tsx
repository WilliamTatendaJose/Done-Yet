import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { AppState } from '../../../src/domain/types';
import { requestNotificationPermission, sendTestNotification } from '../notifications/native';
import { exportBackup, pickBackup } from '../state/backup';
import { colors, radii, spacing } from '../theme';

interface Props {
  state: AppState;
  saving: boolean;
  onNativeNotificationsChange: (enabled: boolean) => Promise<boolean>;
  importSnapshot: (raw: string) => Promise<boolean>;
  count: number;
}

export function ReleaseSettings({ state, saving, onNativeNotificationsChange, importSnapshot, count }: Props) {
  const [busy, setBusy] = useState(false);
  const blocked = saving || busy;
  async function enable(value: boolean) {
    setBusy(true);
    try {
      if (value && !(await requestNotificationPermission())) { Alert.alert('Notifications not enabled', 'Allow notifications in device settings to receive background reminders.', [{ text: 'Later' }, { text: 'Open settings', onPress: () => { void Linking.openSettings(); } }]); return; }
      await onNativeNotificationsChange(value);
    } catch { Alert.alert('Could not enable reminders', 'Please try again.'); }
    finally { setBusy(false); }
  }
  async function backup() {
    setBusy(true);
    try { await exportBackup(state); } catch { Alert.alert('Backup failed', 'The backup could not be shared. Please try again.'); }
    finally { setBusy(false); }
  }
  async function testNotification() {
    setBusy(true);
    try {
      if (!(await sendTestNotification())) {
        Alert.alert('Notification channel blocked', 'Allow Done Yet? notifications and the Accountability reminders channel in device settings.', [{ text: 'Later' }, { text: 'Open settings', onPress: () => { void Linking.openSettings(); } }]);
        return;
      }
      Alert.alert('Test scheduled', 'A notification should appear in about two seconds. This test ignores quiet hours.');
    } catch {
      Alert.alert('Test failed', 'Android could not schedule the test reminder. Check Notifications and Alarms & reminders in device settings.');
    } finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true);
    try {
      const raw = await pickBackup(); if (!raw) return;
      Alert.alert('Replace current tasks?', 'This replaces local tasks and projects with the selected backup. The previous save is kept locally. Background reminders will be turned off.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Restore', onPress: async () => { setBusy(true); try { await importSnapshot(raw); } finally { setBusy(false); } } }]);
    } catch { Alert.alert('Backup not valid', 'Choose an unmodified Done Yet? JSON backup under 2 MB. Existing data has not changed.'); }
    finally { setBusy(false); }
  }
  return <View style={styles.container}>
    <View style={styles.settingRow}><View style={styles.copy}><Text style={styles.title}>Background reminders</Text><Text style={styles.caption}>{count} queued on this device. Open the app regularly to replenish the bounded queue.</Text></View><Switch accessibilityLabel="Background reminders" value={!!state.settings.nativeNotificationsEnabled} disabled={blocked} onValueChange={value => { void enable(value); }} /></View>
    <Text style={styles.caption}>Task titles stay hidden in notification text. On Android 12+, also allow Alarms & reminders for on-time delivery.</Text>
    <View style={styles.actions}>{[{ label: 'Send test reminder', action: testNotification }, { label: 'Export backup', action: backup }, { label: 'Import backup', action: restore }].map(item => <Pressable key={item.label} disabled={blocked} accessibilityRole="button" accessibilityState={{ disabled: blocked }} onPress={() => { void item.action(); }} style={({ pressed }) => [styles.action, (blocked || pressed) && styles.dimmed]}><Text style={styles.actionText}>{item.label}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.md, paddingVertical: spacing.lg },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  copy: { flex: 1 },
  title: { color: colors.text, fontSize: 16 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  action: { minHeight: 48, padding: 14, backgroundColor: colors.surfaceStrong, borderRadius: radii.sm },
  actionText: { color: colors.accent },
  dimmed: { opacity: 0.5 },
});
