import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './ui';
import type { CloudSyncState } from '../cloud/useCloudSync';
import { colors, radii, spacing } from '../theme';

interface Props extends CloudSyncState {
  /** Opens the account screen (mobile/src/features/account/AccountModal.tsx) — reachable both to recover a forgotten password while signed out and to manage the account, including deletion, while signed in. */
  onOpenAccount: () => void;
}

export function CloudSyncSettings(props: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = props.status === 'syncing';

  async function signIn() {
    if (!email.trim() || !password) return;
    await props.signIn(email, password);
    setPassword('');
  }

  async function signUp() {
    if (!email.trim() || !password) return;
    const result = await props.signUp(email, password);
    if (result.ok) setPassword('');
  }

  return <View style={styles.card}>
    <Text style={styles.eyebrow}>OPTIONAL CLOUD SYNC</Text>
    <Text style={styles.title}>Your work, wherever you are.</Text>
    {!props.configured ? <Text style={styles.body}>Cloud sync is not configured for this build. Add the public Supabase URL and anonymous key at build time; local storage continues to work without them.</Text> : props.email ? <>
      <Text style={styles.body}>Signed in as {props.email}. Local changes sync in the background when a connection is available.</Text>
      {props.lastSyncedAt ? <Text style={styles.caption}>Last synced {new Date(props.lastSyncedAt).toLocaleString()}</Text> : null}
      {props.message ? <Text accessibilityRole="alert" style={props.status === 'error' ? styles.error : styles.caption}>{props.message}</Text> : null}
      <View style={styles.actions}><Button label={busy ? 'Syncing…' : 'Sync now'} disabled={busy} onPress={() => { void props.syncNow(); }} /><Button quiet label="Manage account" disabled={busy} onPress={props.onOpenAccount} /></View>
    </> : <>
      <Text style={styles.body}>Sign in to keep tasks and projects available across your devices. Your device remains usable offline.</Text>
      <TextInput accessibilityLabel="Cloud email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} style={styles.input} />
      <TextInput accessibilityLabel="Cloud password" autoCapitalize="none" autoComplete="password" secureTextEntry placeholder="Password (8+ characters)" placeholderTextColor={colors.textMuted} value={password} onChangeText={setPassword} style={styles.input} />
      {props.message ? <Text accessibilityRole="alert" style={props.status === 'error' ? styles.error : styles.caption}>{props.message}</Text> : null}
      <View style={styles.actions}><Button label={busy ? 'Signing in…' : 'Sign in and sync'} disabled={busy || !email.trim() || password.length < 8} onPress={() => { void signIn(); }} /><Button quiet label="Create account" disabled={busy || !email.trim() || password.length < 8} onPress={() => { void signUp(); }} /></View>
      <Button quiet label="Forgot password?" onPress={props.onOpenAccount} />
    </>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: 20, gap: spacing.md, marginTop: 10 },
  eyebrow: { color: colors.accent, fontSize: 11, letterSpacing: 1.6, fontWeight: '700' },
  title: { color: colors.text, fontSize: 19, fontWeight: '700' },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.errorText, backgroundColor: colors.errorSurface, borderRadius: radii.sm, padding: 10, fontSize: 12, lineHeight: 18 },
  input: { backgroundColor: colors.surfaceStrong, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, color: colors.text, minHeight: 48, paddingHorizontal: 14, fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});

