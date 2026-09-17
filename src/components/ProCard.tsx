import { StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { colors, radii, spacing } from '../theme';
import type { RevenueCatClient } from '../cloud/revenueCat';

export function ProCard({ billing }: { billing: RevenueCatClient }) {
  const { state } = billing;
  return <View style={styles.card}>
    <Text style={styles.title}>{state.developerOverride ? 'Done Yet? Pro · Developer override' : state.isPro ? 'Done Yet? Pro' : 'Unlock Done Yet? Pro'}</Text>
    <Text style={styles.body}>{state.developerOverride ? 'Paid features are unlocked locally for development. Production builds always require a real entitlement.' : state.isPro ? 'AI brain dump, AI first steps when you’re stuck, cloud sync and unlimited attachments are active.' : 'Dump everything on your mind and AI turns it into tasks. Stuck? AI gives you a first step you can start in five minutes. Plus cloud sync and unlimited attachments. Local features stay free.'}</Text>
    {!state.isPro ? state.packages.map(plan => (
      <Button
        key={plan.identifier}
        label={state.loading ? 'Working…' : `${plan.product.title} · ${plan.product.priceString}`}
        onPress={async () => { await billing.purchase(plan.identifier); }}
        disabled={state.loading || !state.configured}
      />
    )) : null}
    {!state.developerOverride ? <Button quiet label="Restore purchases" onPress={async () => { await billing.restore(); }} disabled={state.loading || !state.configured} /> : null}
    {state.isPro && !state.developerOverride ? <Button quiet label="Manage subscription" onPress={billing.manageSubscriptions} /> : null}
    {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
    {!state.configured ? <Text style={styles.small}>Sign in first. Purchases are available in a development build once store products are configured.</Text> : null}
    {state.configured && !state.isPro && state.packages.length === 0 ? <Text style={styles.small}>No Pro plan is available right now.</Text> : null}
    {!state.isPro && state.packages.length > 0 ? <Text style={styles.small}>Payment renews through your app store unless cancelled. The store confirms the price and trial, if offered, before purchase.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderColor: colors.accent, borderWidth: 1, borderRadius: radii.lg, padding: 20, gap: spacing.sm }, title: { color: colors.text, fontSize: 17, fontWeight: '700' }, body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 }, small: { color: colors.textMuted, fontSize: 11 }, error: { color: colors.errorText, fontSize: 12 } });
