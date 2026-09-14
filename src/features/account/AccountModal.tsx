import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppState } from '../../../../src/domain/types';
import type { CloudSyncState } from '../../cloud/useCloudSync';
import { exportBackup } from '../../state/backup';
import { Button, IconButton } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  cloud: CloudSyncState;
  state: AppState | null;
}

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const MIN_PASSWORD_LENGTH = 8;

/**
 * The account screen reachable from Settings. It has two shapes rather than two routes:
 * signed out shows only "forgot password" (no other account action makes sense without a
 * session), signed in shows the account email, a password change, sign out, and account
 * deletion. Both read the same `cloud` state Settings already holds.
 */
export function AccountModal({ visible, onClose, cloud, state }: Props) {
  if (!visible) return null;
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ACCOUNT</Text>
        <IconButton name="close" label="Close account settings" onPress={onClose} />
      </View>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!cloud.configured
            ? <Text style={styles.body}>Cloud sync is not configured for this build, so there is no cloud account to manage. Your tasks and projects remain on this device.</Text>
            : cloud.email
              ? <SignedInAccount cloud={cloud} state={state} onClose={onClose} />
              : <SignedOutAccount cloud={cloud} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

function SignedOutAccount({ cloud }: { cloud: CloudSyncState }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const canSend = validEmail(email) && !busy;

  async function send() {
    setBusy(true);
    try { await cloud.requestPasswordReset(email); }
    // The exact wording is shown regardless of what the request actually resolved to — see
    // requestPasswordReset's own comment on why an unknown address must look identical to a
    // known one. A real transport failure and "no such account" would otherwise be
    // distinguishable to anyone probing the flow.
    finally { setBusy(false); setSent(true); }
  }

  return <View style={styles.card}>
    <Text style={styles.title}>Forgot your password?</Text>
    <Text style={styles.body}>Enter the email you used for cloud sync. If it has an account, we'll send a reset link.</Text>
    <TextInput
      accessibilityLabel="Email for password reset"
      autoCapitalize="none"
      autoComplete="email"
      keyboardType="email-address"
      placeholder="Email"
      placeholderTextColor={colors.textMuted}
      value={email}
      onChangeText={value => { setEmail(value); setSent(false); }}
      style={styles.input}
    />
    {sent ? <Text accessibilityRole="alert" style={styles.caption}>If that address has an account, a reset link is on its way.</Text> : null}
    <Button label={busy ? 'Sending…' : 'Send reset link'} disabled={!canSend} onPress={() => { void send(); }} />
  </View>;
}

function SignedInAccount({ cloud, state, onClose }: { cloud: CloudSyncState; state: AppState | null; onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const passwordsReady = newPassword.length >= MIN_PASSWORD_LENGTH && newPassword === confirmPassword;
  const emailConfirmed = confirmEmail.trim().toLowerCase() === (cloud.email ?? '').trim().toLowerCase();

  async function changePassword() {
    setPasswordBusy(true);
    try {
      const result = await cloud.changePassword(newPassword);
      setPasswordMessage(result.message);
      if (result.ok) { setNewPassword(''); setConfirmPassword(''); }
    } finally { setPasswordBusy(false); }
  }

  async function backupFirst() {
    if (!state) return;
    setExporting(true);
    try { await exportBackup(state); }
    catch { Alert.alert('Backup failed', 'The backup could not be shared. Please try again.'); }
    finally { setExporting(false); }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This deletes your cloud account, your cloud copy of tasks and projects, and any attachments you uploaded. It does not touch the tasks, projects, or files already on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => { void performDelete(); } },
      ],
    );
  }

  async function performDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      const result = await cloud.deleteAccount();
      // A successful deletion has already signed this device out and cleared its stored
      // session (see deleteAccount in useCloudSync.ts) — closing here just leaves the
      // account screen once there is nothing left in it to manage.
      if (result.ok) onClose();
      else setDeleteError(result.message);
    } finally { setDeleting(false); }
  }

  return <>
    <View style={styles.card}>
      <Text style={styles.eyebrow}>SIGNED IN AS</Text>
      <Text style={styles.title}>{cloud.email}</Text>
      {cloud.lastSyncedAt ? <Text style={styles.caption}>Last synced {new Date(cloud.lastSyncedAt).toLocaleString()}</Text> : null}
    </View>

    <View style={styles.card}>
      <Text style={styles.fieldLabel}>Change password</Text>
      <TextInput accessibilityLabel="New password" autoCapitalize="none" secureTextEntry placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`} placeholderTextColor={colors.textMuted} value={newPassword} onChangeText={setNewPassword} style={styles.input} />
      <TextInput accessibilityLabel="Confirm new password" autoCapitalize="none" secureTextEntry placeholder="Confirm new password" placeholderTextColor={colors.textMuted} value={confirmPassword} onChangeText={setConfirmPassword} style={styles.input} />
      {newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword ? <Text style={styles.error}>Passwords don't match.</Text> : null}
      {passwordMessage ? <Text accessibilityRole="alert" style={styles.caption}>{passwordMessage}</Text> : null}
      <Button label={passwordBusy ? 'Updating…' : 'Update password'} disabled={passwordBusy || !passwordsReady} onPress={() => { void changePassword(); }} />
    </View>

    <View style={styles.card}>
      <Button quiet label="Sign out" onPress={() => { void cloud.signOut().then(() => onClose()); }} />
    </View>

    <View style={[styles.card, styles.dangerCard]}>
      <Text style={styles.fieldLabel}>Delete account</Text>
      <Text style={styles.body}>Deleting your account removes your cloud account, your cloud copy of tasks and projects, and any files you uploaded as attachments. It does not remove tasks, projects, or files already stored on this device.</Text>
      <Button quiet icon="cloud-download-outline" label={exporting ? 'Exporting…' : 'Export a backup first'} disabled={exporting || !state} onPress={() => { void backupFirst(); }} />
      <Text style={styles.small}>Type your email address to confirm deletion.</Text>
      <TextInput
        accessibilityLabel="Confirm your email to delete your account"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        placeholder={cloud.email ?? 'Email'}
        placeholderTextColor={colors.textMuted}
        value={confirmEmail}
        onChangeText={setConfirmEmail}
        style={styles.input}
      />
      {deleteError ? <Text accessibilityRole="alert" style={styles.error}>{deleteError}</Text> : null}
      <Button label={deleting ? 'Deleting…' : 'Delete account'} disabled={deleting || !emailConfirmed} onPress={confirmDelete} />
    </View>
  </>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  eyebrow: { color: colors.accent, fontSize: 11, letterSpacing: 1.6, fontWeight: '700' },
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: 20, gap: spacing.md },
  dangerCard: { borderColor: colors.errorSurface },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  small: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.errorText, backgroundColor: colors.errorSurface, borderRadius: radii.sm, padding: 10, fontSize: 12, lineHeight: 18 },
  input: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, color: colors.text, minHeight: 48, paddingHorizontal: 14, fontSize: 15 },
});
