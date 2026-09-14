import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { AppState, ReminderLevel } from '../../../src/domain/types';
import { intervals } from '../../../src/domain/engine';
import { ReleaseSettings } from '../components/ReleaseSettings';
import { CloudSyncSettings } from '../components/CloudSyncSettings';
import type { CloudSyncState } from '../cloud/useCloudSync';
import { AccountModal } from '../features/account/AccountModal';
import { CalendarSettings } from '../features/calendar/CalendarSettings';
import { FocusDurationChips } from '../features/focus/FocusDurationChips';
import type { EscalationCandidate } from '../features/escalation/useEscalationSuggestions';
import { describeQueueCoverage } from '../notifications/plan';
import { Button, Choice, Field } from '../components/ui';
import { colors, radii, spacing } from '../theme';
import { ProCard } from '../components/ProCard';
import type { RevenueCatClient } from '../cloud/revenueCat';

const levels: ReminderLevel[] = ['gentle', 'persistent', 'firm', 'relentless'];
// intervalText is derived from the single interval table in src/domain/engine.ts, never a second copy.
const intervalText: Record<ReminderLevel, string> = Object.fromEntries(levels.map(l => [l, `${intervals[l]} min`])) as Record<ReminderLevel, string>;

interface Props {
  state: AppState;
  saving: boolean;
  notificationCount: number;
  onSettingsChange: (input: Partial<AppState['settings']>) => Promise<boolean>;
  onImportSnapshot: (raw: string) => Promise<boolean>;
  cloud: CloudSyncState;
  escalationSuggestions: EscalationCandidate[];
  onApplyEscalation: (id: string, level: ReminderLevel) => void;
  billing: RevenueCatClient;
}

export function SettingsScreen({ state, saving, notificationCount, onSettingsChange, onImportSnapshot, cloud, escalationSuggestions, onApplyEscalation, billing }: Props) {
  const [accountOpen, setAccountOpen] = useState(false);
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>YOU SET THE PACE</Text>
    <Text style={styles.hero}>On your terms.</Text>
    <ReleaseSettings
      state={state}
      saving={saving}
      onNativeNotificationsChange={enabled => onSettingsChange({ nativeNotificationsEnabled: enabled })}
      importSnapshot={onImportSnapshot}
      count={notificationCount}
    />
    <CloudSyncSettings {...cloud} isPro={billing.state.isPro} proResolving={billing.state.resolving} onOpenAccount={() => setAccountOpen(true)} />
    <ProCard billing={billing} />
    <AccountModal visible={accountOpen} onClose={() => setAccountOpen(false)} cloud={cloud} state={state} />
    <CalendarSettings state={state} saving={saving} onSettingsChange={onSettingsChange} />
    <View style={styles.card}>
      <Text style={styles.fieldLabel}>Default persistence</Text>
      <Text style={styles.small}>Applies to new tasks. Each task keeps its own setting.</Text>
      <View style={styles.wrap}>{levels.map(level => <Choice key={level} label={`${level} · ${intervalText[level]}`} selected={state.settings.defaultLevel === level} onPress={() => { void onSettingsChange({ defaultLevel: level }); }} />)}</View>
      <Text style={styles.small}>{describeQueueCoverage(intervals[state.settings.defaultLevel])} A shorter interval covers less time before you need to reopen the app.</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.fieldLabel}>Default focus length</Text>
      <Text style={styles.small}>How long a focus session runs when you start one without picking a length. Five minutes stays the recommended starting point — small is the point.</Text>
      <FocusDurationChips selected={state.settings.focusMinutes ?? 5} onSelect={minutes => { void onSettingsChange({ focusMinutes: minutes }); }} />
    </View>
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}><Text style={styles.taskTitle}>Pause reminders</Text><Text style={styles.small}>Take a breather whenever you need.</Text></View>
      <Switch accessibilityLabel="Pause reminders" value={state.settings.remindersPaused} onValueChange={value => { void onSettingsChange({ remindersPaused: value }); }} trackColor={{ true: colors.accent }} thumbColor={colors.text} />
    </View>
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}><Text style={styles.taskTitle}>Quiet hours</Text><Text style={styles.small}>{state.settings.quietStart}:00–{state.settings.quietEnd}:00</Text></View>
      <Switch accessibilityLabel="Quiet hours" value={state.settings.quietHoursEnabled} onValueChange={value => { void onSettingsChange({ quietHoursEnabled: value }); }} trackColor={{ true: colors.accent }} thumbColor={colors.text} />
    </View>
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}><Text style={styles.taskTitle}>Escalate automatically</Text><Text style={styles.small}>Off by default. When on, Done Yet? applies its own suggested reminder increases; otherwise you approve each one below.</Text></View>
      <Switch accessibilityLabel="Escalate automatically" value={!!state.settings.autoEscalate} onValueChange={value => { void onSettingsChange({ autoEscalate: value }); }} trackColor={{ true: colors.accent }} thumbColor={colors.text} />
    </View>
    {escalationSuggestions.length > 0 && !state.settings.autoEscalate ? <View style={styles.card}>
      <Text style={styles.fieldLabel}>Suggested reminder changes</Text>
      {escalationSuggestions.map(s => <View key={s.taskId} style={styles.wrap}>
        <Text style={styles.small}>{s.reason}</Text>
        <Button quiet label={`Make "${s.title}" ${s.level}`} onPress={() => onApplyEscalation(s.taskId, s.level)} />
      </View>)}
    </View> : null}
    <View style={styles.settingRow}>
      <View style={styles.settingCopy}>
        <Text style={styles.taskTitle}>AI assistance (cloud)</Text>
        <Text style={styles.small}>
          A Pro feature, off by default. When you turn this on, three specific actions you tap for yourself can
          send a small, fixed request to an AI service: breaking a project into steps sends only its
          title, description and days remaining; reading a status update sends only the sentence you
          typed; planning today sends only your open tasks' titles and due times. Nothing else about
          a task or project — no notes, ids, tags or history — is ever included, and every one of
          those requests shows you exactly what it would send and waits for you to confirm before
          anything leaves this device. Requires being signed in to cloud sync, since the request goes
          through your account. Turning this off again stops all of it immediately.
        </Text>
      </View>
      <Switch accessibilityLabel="AI assistance (cloud)" disabled={!billing.state.isPro} value={!!state.settings.aiAssistEnabled && billing.state.isPro} onValueChange={value => { void onSettingsChange({ aiAssistEnabled: value }); }} trackColor={{ true: colors.accent }} thumbColor={colors.text} />
    </View>
    <Field label="Coach personality">
      <View style={styles.wrap}>{(['supportive', 'direct', 'minimal'] as const).map(personality => <Choice key={personality} label={personality} selected={state.settings.personality === personality} onPress={() => { void onSettingsChange({ personality }); }} />)}</View>
    </Field>
    <View style={styles.card}>
      <Ionicons name="phone-portrait-outline" color={colors.accent} size={24} />
      <Text style={styles.fieldLabel}>Native app · local data</Text>
      <Text style={styles.body}>
        Tasks are stored on this phone first. Cloud sync is optional and only sends your snapshot
        after you sign in. Duration estimates and on-device step suggestions run on this device and
        are never sent anywhere. AI assistance above is {state.settings.aiAssistEnabled
          ? 'on — the three actions described above can send the small, fixed requests noted there, only when you tap them and only after you confirm'
          : 'off — no task or project details reach any AI service'}.
      </Text>
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  eyebrow: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  hero: { color: colors.text, fontSize: 35, lineHeight: 41, fontWeight: '700', letterSpacing: -1.3 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  small: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: 20, gap: spacing.md, marginTop: 10 },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.border },
  settingCopy: { flex: 1, gap: spacing.xs },
  taskTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 22 },
});
