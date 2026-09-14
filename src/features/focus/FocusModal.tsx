import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FocusSession, Task } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';
import { Button, IconButton } from '../../components/ui';
import { useAppClock } from '../../hooks/useAppClock';
import type { TabName } from '../../navigation';
import { colors, spacing } from '../../theme';

interface Props {
  session: FocusSession | null;
  task: Task | undefined;
  dispatch: (action: Action) => Promise<boolean>;
  navigate: (tab: TabName) => void;
  error: string;
}

export function FocusModal({ session, task, dispatch, navigate, error }: Props) {
  if (!session || !task) return null;
  return <ActiveFocusModal session={session} task={task} dispatch={dispatch} navigate={navigate} error={error} />;
}

function ActiveFocusModal({ session, task, dispatch, navigate, error }: Omit<Props, 'session' | 'task'> & { session: FocusSession; task: Task }) {
  const now = useAppClock(1000);
  const remaining = session.paused
    ? session.remainingSeconds
    : Math.max(0, Math.ceil((Date.parse(session.endsAt) - now) / 1000));

  return (
    <Modal visible animationType="slide" onRequestClose={() => { void dispatch({ type: 'endFocus' }); }}>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.eyebrow}>ONE THING AT A TIME</Text>
          <IconButton name="close" label="End focus" onPress={async () => { await dispatch({ type: 'endFocus' }); }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Text style={styles.heading}>{remaining === 0 ? 'Five minutes invested.' : task.title}</Text>
          <View style={styles.timerCircle} accessible accessibilityLabel={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}>
            <Text style={styles.timer}>{Math.floor(remaining / 60).toString().padStart(2, '0')}:{(remaining % 60).toString().padStart(2, '0')}</Text>
            <Text style={styles.caption}>{remaining === 0 ? 'A little more momentum' : session.paused ? 'Paused' : 'Just this next step'}</Text>
          </View>
          <Text style={styles.body}>Your reminders are quiet while you focus.</Text>
          <Button label="Finished this step" icon="checkmark" onPress={async () => { await dispatch({ type: 'completeTask', id: task.id }); }} />
          {remaining > 0 ? <Button quiet label={session.paused ? 'Resume' : 'Pause'} onPress={async () => { await dispatch({ type: session.paused ? 'resumeFocus' : 'pauseFocus' }); }} /> : null}
          <Button quiet label="I’m blocked" onPress={async () => {
            if (await dispatch({ type: 'endFocus' })) navigate('Coach');
          }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  content: { padding: spacing.xxl, gap: 18, flexGrow: 1, justifyContent: 'center' },
  eyebrow: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  heading: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: '600', textAlign: 'center' },
  timerCircle: { width: 240, height: 240, borderRadius: 120, borderWidth: 3, borderColor: colors.accent, alignSelf: 'center', justifyContent: 'center', alignItems: 'center', gap: 10, marginVertical: 20 },
  timer: { color: colors.text, fontSize: 58, fontWeight: '500', fontVariant: ['tabular-nums'], letterSpacing: -2 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23, textAlign: 'center' },
  error: { color: colors.errorText, padding: 14, backgroundColor: colors.errorSurface, borderRadius: 12 },
});
