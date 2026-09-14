import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import type { AppState, Settings } from '../../../../src/domain/types';
import { requestCalendarPermission } from './native';
import { colors, spacing } from '../../theme';

interface Props {
  state: AppState;
  saving: boolean;
  onSettingsChange: (input: Partial<Settings>) => Promise<boolean>;
}

/**
 * Two independent, opt-in, off-by-default switches (see domain/types.ts Settings for the contract):
 * mirroring a task's deadline into the app's own "Done Yet?" calendar, and a busy-check read that
 * only ever reports a count and busy/free. Turning either on requests the OS calendar permission
 * first and, like notifications' ReleaseSettings, degrades gracefully — a denial leaves the switch
 * off and points at device settings rather than leaving the app in a half-enabled state.
 */
export function CalendarSettings({ state, saving, onSettingsChange }: Props) {
  const [busy, setBusy] = useState(false);
  const blocked = saving || busy;

  async function toggle(key: 'calendarWriteEnabled' | 'calendarBusyCheckEnabled', value: boolean) {
    setBusy(true);
    try {
      if (value && !(await requestCalendarPermission())) {
        Alert.alert('Calendar access not granted', 'Allow calendar access in device settings to use this.', [{ text: 'Later' }, { text: 'Open settings', onPress: () => { void Linking.openSettings(); } }]);
        return;
      }
      await onSettingsChange({ [key]: value });
    } catch {
      Alert.alert('Could not update calendar settings', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.container}>
    <View style={styles.settingRow}>
      <View style={styles.copy}>
        <Text style={styles.title}>Sync deadlines to calendar</Text>
        <Text style={styles.caption}>Creates a dedicated "Done Yet?" calendar and mirrors each task's deadline into it as an event, keeping it updated as you edit, complete, or delete the task. Done Yet? never writes into your existing calendars.</Text>
      </View>
      <Switch accessibilityLabel="Sync deadlines to calendar" value={!!state.settings.calendarWriteEnabled} disabled={blocked} onValueChange={value => { void toggle('calendarWriteEnabled', value); }} trackColor={{ true: colors.accent }} thumbColor={colors.text} />
    </View>
    <View style={styles.settingRow}>
      <View style={styles.copy}>
        <Text style={styles.title}>Warn about calendar conflicts</Text>
        <Text style={styles.caption}>When you set a deadline, checks a two-hour window of your calendar around it and warns if something else is already scheduled there. Only a count of nearby events is read — never their titles, and nothing is stored.</Text>
      </View>
      <Switch accessibilityLabel="Warn about calendar conflicts" value={!!state.settings.calendarBusyCheckEnabled} disabled={blocked} onValueChange={value => { void toggle('calendarBusyCheckEnabled', value); }} trackColor={{ true: colors.accent }} thumbColor={colors.text} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  copy: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
});
