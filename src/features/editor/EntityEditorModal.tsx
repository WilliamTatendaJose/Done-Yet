import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppState, Attachment, Milestone, Project, RecurrenceRule, ReminderLevel, Subtask, Task } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';
import { Button, Choice, Field, IconButton } from '../../components/ui';
import { RepeatFields } from './RepeatFields';
import { TagFields } from './TagFields';
import { SubtaskFields } from './SubtaskFields';
import { MilestoneFields } from './MilestoneFields';
import { AttachmentFields } from './AttachmentFields';
import { deleteAttachmentFile } from '../attachments/storage';
import type { AttachmentDownloadOutcome } from '../../cloud/useCloudSync';
import { colors, spacing } from '../../theme';

export type EditorSelection =
  | { kind: 'task'; task?: Task }
  | { kind: 'project'; project?: Project }
  | null;

/** Cloud plumbing for attachments: queuing a durable upload/delete, and fetching a remote-only file on demand. Absent when cloud sync is not configured. */
export interface AttachmentSyncProps {
  enqueueUpload(attachment: Attachment): Promise<void>;
  enqueueDelete(attachment: Pick<Attachment, 'id' | 'remoteKey'>): Promise<void>;
  download(attachment: Attachment): Promise<AttachmentDownloadOutcome>;
}

interface Props {
  selection: EditorSelection;
  state: AppState;
  saving: boolean;
  error: string;
  dispatch: (action: Action) => Promise<boolean>;
  onClose: () => void;
  attachmentSync?: AttachmentSyncProps;
}

const levels: ReminderLevel[] = ['gentle', 'persistent', 'firm', 'relentless'];
const intervalText: Record<ReminderLevel, string> = {
  gentle: '30 min',
  persistent: '15 min',
  firm: '5 min',
  relentless: '2 min',
};

export function EntityEditorModal(props: Props) {
  const { selection } = props;
  if (!selection) return null;
  const id = selection.kind === 'task' ? selection.task?.id : selection.project?.id;
  return <EditorForm key={`${selection.kind}:${id ?? 'new'}`} {...props} selection={selection} />;
}

function EditorForm({ selection, state, saving, error, dispatch, onClose, attachmentSync }: Props & { selection: NonNullable<EditorSelection> }) {
  const task = selection.kind === 'task' ? selection.task : undefined;
  const project = selection.kind === 'project' ? selection.project : undefined;
  const [title, setTitle] = useState(task?.title ?? project?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? project?.description ?? '');
  const [hasDue, setHasDue] = useState(Boolean(task?.dueAt) || selection.kind === 'project');
  const [due, setDue] = useState(() => task?.dueAt ? new Date(task.dueAt) : project?.dueAt ? new Date(project.dueAt) : new Date(Date.now() + 86_400_000));
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [mode, setMode] = useState<Task['reminderMode']>(task?.reminderMode ?? 'normal');
  const [level, setLevel] = useState<ReminderLevel>(task?.reminderLevel ?? state.settings.defaultLevel);
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'medium');
  const [projectId, setProjectId] = useState<string | null>(task?.projectId ?? null);
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(task?.recurrence ?? null);
  const [tags, setTags] = useState<string[]>(task?.tags ?? []);
  const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks ?? []);
  const [milestones, setMilestones] = useState<Milestone[]>(project?.milestones ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? []);
  const [originalAttachmentIds] = useState(() => new Set((task?.attachments ?? []).map(a => a.id)));

  const isProject = selection.kind === 'project';
  const heading = isProject ? project ? 'Edit project' : 'New project' : task ? 'Edit task' : 'New task';

  async function save() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    let saved: boolean;
    if (isProject) {
      const input = { title: cleanTitle, description: notes, dueAt: due.toISOString(), milestones };
      saved = await dispatch(project
        ? { type: 'updateProject', id: project.id, input }
        : { type: 'addProject', id: randomUUID(), input });
    } else {
      const input = {
        title: cleanTitle,
        notes,
        projectId,
        priority,
        dueAt: hasDue ? due.toISOString() : null,
        reminderMode: mode,
        reminderLevel: level,
        recurrence: hasDue ? repeat : null,
        tags,
        subtasks,
        attachments,
      };
      saved = await dispatch(task
        ? { type: 'updateTask', id: task.id, input }
        : { type: 'addTask', id: randomUUID(), input });
      if (saved) {
        // Files for attachments that existed on the task but were removed in this form are now
        // safe to delete — the saved state no longer references them. A failed delete is never
        // allowed to block the save that already succeeded, so it's best-effort here.
        const kept = new Set(attachments.map(a => a.id));
        for (const gone of task?.attachments ?? []) {
          if (!kept.has(gone.id)) {
            if (gone.localName) { try { deleteAttachmentFile(gone.localName); } catch { /* orphaned bytes are recoverable */ } }
            // A remote copy of a removed attachment must not linger in the bucket as an orphan.
            if (gone.remoteKey) void attachmentSync?.enqueueDelete(gone);
          }
        }
        // Newly added attachments (not present when the form opened) queue for upload so a
        // second device can eventually see them too; this is durable and survives an app kill.
        for (const added of attachments) {
          if (!originalAttachmentIds.has(added.id) && added.localName && !added.remoteKey) void attachmentSync?.enqueueUpload(added);
        }
      }
    }
    if (saved) onClose();
  }

  function confirmDelete() {
    const entity = task ?? project;
    if (!entity) return;
    Alert.alert(
      `Delete ${isProject ? 'project' : 'task'}?`,
      isProject ? 'Tasks in this project will stay in your list.' : entity.title,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const saved = await dispatch(isProject
              ? { type: 'deleteProject', id: entity.id }
              : { type: 'deleteTask', id: entity.id });
            if (saved && !isProject) {
              for (const gone of task?.attachments ?? []) {
                if (gone.localName) { try { deleteAttachmentFile(gone.localName); } catch { /* orphaned bytes are recoverable */ } }
                if (gone.remoteKey) void attachmentSync?.enqueueDelete(gone);
              }
            }
            if (saved) onClose();
          },
        },
      ],
    );
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="light" />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.header}>
            <Text style={styles.heading}>{heading}</Text>
            <IconButton name="close" label="Close editor" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Field label={isProject ? 'Project name' : 'What needs doing?'}>
              <TextInput accessibilityLabel="Title" autoFocus style={styles.input} value={title} onChangeText={setTitle} placeholder="One small, specific action" placeholderTextColor={colors.textMuted} />
            </Field>
            <Field label={isProject ? 'Description' : 'Notes'}>
              <TextInput accessibilityLabel="Notes" style={[styles.input, styles.notes]} multiline value={notes} onChangeText={setNotes} placeholder="Optional context" placeholderTextColor={colors.textMuted} />
            </Field>
            {!isProject ? <>
              <Field label="Priority"><View style={styles.wrap}>{(['low', 'medium', 'high'] as const).map(value => <Choice key={value} label={value} selected={priority === value} onPress={() => setPriority(value)} />)}</View></Field>
              {state.projects.length ? <Field label="Project"><View style={styles.wrap}><Choice label="None" selected={projectId === null} onPress={() => setProjectId(null)} />{state.projects.map(item => <Choice key={item.id} label={item.title} selected={projectId === item.id} onPress={() => setProjectId(item.id)} />)}</View></Field> : null}
              <TagFields value={tags} tasks={state.tasks} onChange={setTags} />
            </> : null}
            <View style={styles.between}>
              <Text style={styles.fieldLabel}>Set a deadline</Text>
              {!isProject ? <Switch accessibilityLabel="Set a deadline" value={hasDue} onValueChange={setHasDue} trackColor={{ true: colors.accent }} /> : null}
            </View>
            {hasDue || isProject ? <>
              <View style={styles.wrap}>
                <Button quiet label={due.toLocaleDateString()} icon="calendar-outline" onPress={() => setPicker('date')} />
                <Button quiet label={due.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} icon="time-outline" onPress={() => setPicker('time')} />
              </View>
              {picker ? <DateTimePicker value={due} mode={picker} themeVariant="dark" onChange={(_, selected) => { if (Platform.OS === 'android') setPicker(null); if (selected) setDue(selected); }} /> : null}
            </> : null}
            {isProject ? <MilestoneFields value={milestones} onChange={setMilestones} /> : null}
            {!isProject && hasDue ? <RepeatFields value={repeat} dueAt={due} onChange={setRepeat} /> : null}
            {!isProject ? <>
              <Field label="Reminder mode"><View style={styles.wrap}><Choice label="Normal" selected={mode === 'normal'} onPress={() => setMode('normal')} /><Choice label="Annoy me" selected={mode === 'annoy'} onPress={() => setMode('annoy')} /></View></Field>
              {mode === 'annoy' ? <Field label="How persistent?"><View style={styles.wrap}>{levels.map(value => <Choice key={value} label={`${value} · ${intervalText[value]}`} selected={level === value} onPress={() => setLevel(value)} />)}</View></Field> : null}
              <SubtaskFields value={subtasks} onChange={setSubtasks} />
              <AttachmentFields value={attachments} originalIds={originalAttachmentIds} onChange={setAttachments} downloadAttachment={attachmentSync?.download} />
            </> : null}
            <Button label="Save" disabled={!title.trim() || saving} onPress={save} />
            {task || project ? <Button quiet label={`Delete ${isProject ? 'project' : 'task'}`} onPress={confirmDelete} /> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  heading: { color: colors.text, fontSize: 23, fontWeight: '700' },
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, color: colors.text, fontSize: 16, minHeight: 50 },
  notes: { minHeight: 90, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  error: { color: colors.errorText, padding: 14, backgroundColor: colors.errorSurface, borderRadius: 12 },
});
