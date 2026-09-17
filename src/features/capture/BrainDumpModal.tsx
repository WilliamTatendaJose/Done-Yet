import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AiPayload } from '../../../../src/domain/aiPayload';
import { parseCapturedTasks, type CapturedTask } from '../../../../src/domain/aiResponse';
import type { Action } from '../../../../src/state/model';
import type { AiAssistState } from '../../cloud/useAiAssist';
import { Button, IconButton } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  visible: boolean;
  now: number;
  ai: AiAssistState;
  dispatch: (action: Action) => Promise<boolean>;
  onClose: () => void;
}

type Draft = CapturedTask & { key: string; include: boolean };

const MAX_TEXT = 1500;

function dueLabel(draft: CapturedTask) {
  if (!draft.dueAt) return null;
  const date = new Date(draft.dueAt);
  const day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return draft.hasTime ? `${day}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : day;
}

/**
 * Brain dump → tasks. The model only ever proposes: every parsed task is shown for review, each can
 * be left out, and nothing reaches state until "Add" — through the ordinary addTask action, so the
 * reducer's own validation (tags, subtask caps, dates) still applies to everything the AI returned.
 */
export function BrainDumpModal({ visible, now, ai, dispatch, onClose }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const included = drafts?.filter(draft => draft.include) ?? [];

  function close() {
    if (busy) return;
    setError(''); setDrafts(null);
    onClose();
  }

  function organise() {
    const payload = ai.prepare('capture', { text }, new Date(now));
    if (!payload) { setError('Write down what’s on your mind first.'); return; }
    setError('');
    ai.confirm(payload, () => void run(payload));
  }

  async function run(payload: AiPayload) {
    setBusy(true); setError('');
    const result = await ai.send(payload);
    setBusy(false);
    if (result.status !== 'success') { setError(result.message); return; }
    const tasks = parseCapturedTasks(result.value.text);
    if (!tasks.length) { setError('The AI couldn’t find any tasks in that. Try listing things a little more plainly.'); return; }
    setDrafts(tasks.map(task => ({ ...task, key: randomUUID(), include: true })));
  }

  async function addTasks() {
    setBusy(true);
    let added = 0;
    for (const draft of included) {
      const ok = await dispatch({
        type: 'addTask',
        id: randomUUID(),
        input: {
          title: draft.title,
          priority: draft.priority,
          dueAt: draft.dueAt,
          tags: draft.tags,
          subtasks: draft.steps.map(title => ({ id: randomUUID(), title, done: false })),
        },
      });
      if (ok) added += 1;
    }
    setBusy(false);
    if (added < included.length) { setError(`Added ${added} of ${included.length} tasks. The rest couldn’t be saved.`); return; }
    setText(''); setDrafts(null);
    onClose();
  }

  const toggle = (key: string) => setDrafts(prev => prev?.map(draft => draft.key === key ? { ...draft, include: !draft.include } : draft) ?? null);

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <Text style={styles.heading}>Brain dump</Text>
          <IconButton name="close" label="Close brain dump" onPress={close} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!drafts ? <>
            <Text style={styles.body}>Get it all out of your head — errands, deadlines, the big scary thing. AI sorts it into tasks with dates and steps, and you pick what to keep.</Text>
            <TextInput
              accessibilityLabel="Everything on your mind"
              autoFocus={ai.available}
              editable={!busy}
              multiline
              maxLength={MAX_TEXT}
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder={'e.g. dentist Thursday 3pm, finish the Q3 report by Friday (it’s huge), renew car licence, call mum'}
              placeholderTextColor={colors.textMuted}
            />
            {text.length > MAX_TEXT - 200 ? <Text style={styles.caption}>{MAX_TEXT - text.length} characters left</Text> : null}
            <Button icon="sparkles-outline" label={busy ? 'Sorting it out…' : 'Organise with AI'} disabled={!ai.available || busy || !text.trim()} onPress={organise} />
            <Text style={styles.caption}>{ai.available ? 'Only this text and today’s date and time are sent — nothing about your existing tasks.' : ai.unavailableReason}</Text>
          </> : <>
            <Text style={styles.body}>Here’s what AI found. Tap one to leave it out — you can edit any of them after adding.</Text>
            {drafts.map(draft => <Pressable
              key={draft.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.include }}
              accessibilityLabel={draft.title}
              onPress={() => toggle(draft.key)}
              style={({ pressed }) => [styles.draft, !draft.include && styles.excluded, pressed && styles.pressed]}
            >
              <Ionicons name={draft.include ? 'checkbox' : 'square-outline'} size={22} color={draft.include ? colors.accent : colors.textMuted} />
              <View style={styles.draftCopy}>
                <Text style={styles.draftTitle}>{draft.title}</Text>
                <Text style={styles.caption}>{[dueLabel(draft), draft.priority !== 'medium' ? `${draft.priority} priority` : null, draft.tags.length ? draft.tags.map(tag => `#${tag}`).join(' ') : null, draft.steps.length ? `${draft.steps.length} steps` : null].filter(Boolean).join(' · ') || 'No deadline'}</Text>
              </View>
            </Pressable>)}
            <Button label={busy ? 'Adding…' : `Add ${included.length} task${included.length === 1 ? '' : 's'}`} disabled={busy || included.length === 0} onPress={addTasks} />
            <Button quiet label="Back to my notes" disabled={busy} onPress={() => { setDrafts(null); setError(''); }} />
          </>}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading: { color: colors.text, fontSize: 23, fontWeight: '700' },
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, color: colors.text, fontSize: 16, minHeight: 180, textAlignVertical: 'top' },
  error: { color: colors.errorText, padding: 14, backgroundColor: colors.errorSurface, borderRadius: 12 },
  draft: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.md, padding: spacing.lg },
  excluded: { opacity: 0.55 },
  pressed: { opacity: 0.7 },
  draftCopy: { flex: 1, gap: 2 },
  draftTitle: { color: colors.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
});
