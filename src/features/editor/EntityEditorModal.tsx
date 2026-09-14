import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { StatusBar } from 'expo-status-bar';
import { randomUUID } from 'expo-crypto';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppState, Attachment, Milestone, Project, RecurrenceRule, ReminderLevel, Subtask, Task } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';
import { estimateDuration, type DurationEstimate } from '../../../../src/domain/estimate';
import { suggestSteps } from '../../../../src/domain/breakdown';
import { intervals } from '../../../../src/domain/engine';
import type { AiPayload } from '../../../../src/domain/aiPayload';
import { parseBreakdownSteps } from '../../../../src/domain/aiResponse';
import { describeQueueCoverage } from '../../notifications/plan';
import { Button, Choice, Field, IconButton } from '../../components/ui';
import { RepeatFields } from './RepeatFields';
import { TagFields } from './TagFields';
import { SubtaskFields } from './SubtaskFields';
import { MilestoneFields } from './MilestoneFields';
import { AttachmentFields } from './AttachmentFields';
import { deleteAttachmentFile } from '../attachments/storage';
import { deleteTaskEvent } from '../calendar/native';
import { useBusyWarning } from '../calendar/useBusyWarning';
import type { AttachmentDownloadOutcome } from '../../cloud/useCloudSync';
import type { AiAssistState } from '../../cloud/useAiAssist';
import { colors, spacing } from '../../theme';

/** Plain-language rendering of an on-device DurationEstimate; kept in the UI layer since the domain
 * function only returns numbers and a basis, not copy. Always says "on-device" — this is a rule-based
 * estimate from the user's own history, never a model, and nothing here is sent anywhere. */
function estimateLabel(estimate: DurationEstimate): string {
  const time = estimate.minutes >= 60
    ? `${Math.round((estimate.minutes / 60) * 10) / 10}h`
    : `${estimate.minutes} min`;
  if (estimate.basis === 'default') return `About ${time}, as a starting guess — you don't have finished tasks like this yet. Estimated on-device.`;
  if (estimate.basis === 'similar') return `About ${time}, based on ${estimate.sampleSize} similar task${estimate.sampleSize === 1 ? '' : 's'} you've finished. Estimated on-device.`;
  return `About ${time}, based on ${estimate.sampleSize} task${estimate.sampleSize === 1 ? '' : 's'} you've finished. Estimated on-device.`;
}

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
  now: number;
  dispatch: (action: Action) => Promise<boolean>;
  onClose: () => void;
  attachmentSync?: AttachmentSyncProps;
  ai: AiAssistState;
  isPro?: boolean;
}

const levels: ReminderLevel[] = ['gentle', 'persistent', 'firm', 'relentless'];
// Derived from the single interval table in src/domain/engine.ts, never a second copy.
const intervalText: Record<ReminderLevel, string> = Object.fromEntries(levels.map(l => [l, `${intervals[l]} min`])) as Record<ReminderLevel, string>;
const MIN_CUSTOM_INTERVAL = 5, MAX_CUSTOM_INTERVAL = 1440;

export function EntityEditorModal(props: Props) {
  const { selection } = props;
  if (!selection) return null;
  const id = selection.kind === 'task' ? selection.task?.id : selection.project?.id;
  return <EditorForm key={`${selection.kind}:${id ?? 'new'}`} {...props} selection={selection} />;
}

function EditorForm({ selection, state, saving, error, now, dispatch, onClose, attachmentSync, ai, isPro }: Props & { selection: NonNullable<EditorSelection> }) {
  const task = selection.kind === 'task' ? selection.task : undefined;
  const project = selection.kind === 'project' ? selection.project : undefined;
  const [title, setTitle] = useState(task?.title ?? project?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? project?.description ?? '');
  const [hasDue, setHasDue] = useState(Boolean(task?.dueAt) || selection.kind === 'project');
  const [due, setDue] = useState(() => task?.dueAt ? new Date(task.dueAt) : project?.dueAt ? new Date(project.dueAt) : new Date(Date.now() + 86_400_000));
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [mode, setMode] = useState<Task['reminderMode']>(task?.reminderMode ?? 'normal');
  const [level, setLevel] = useState<ReminderLevel>(task?.reminderLevel ?? state.settings.defaultLevel);
  // Optional per-task override (5-1440 min), taking precedence over the level above when set.
  const [customInterval, setCustomInterval] = useState(task?.reminderIntervalMinutes ? String(task.reminderIntervalMinutes) : '');
  // An empty field means "no override" (null clears it on save); a non-empty one must be in range.
  const customIntervalMinutes = customInterval.trim() ? Number(customInterval) : null;
  const customIntervalValid = customIntervalMinutes === null || (Number.isInteger(customIntervalMinutes) && customIntervalMinutes >= MIN_CUSTOM_INTERVAL && customIntervalMinutes <= MAX_CUSTOM_INTERVAL);
  const effectiveIntervalMinutes = customIntervalValid && customIntervalMinutes !== null ? customIntervalMinutes : intervals[level];
  const [priority, setPriority] = useState<Task['priority']>(task?.priority ?? 'medium');
  const [projectId, setProjectId] = useState<string | null>(task?.projectId ?? null);
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(task?.recurrence ?? null);
  const [tags, setTags] = useState<string[]>(task?.tags ?? []);
  const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks ?? []);
  const [milestones, setMilestones] = useState<Milestone[]>(project?.milestones ?? []);
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? []);
  const [originalAttachmentIds] = useState(() => new Set((task?.attachments ?? []).map(a => a.id)));
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');

  const isProject = selection.kind === 'project';
  // Opt-in, off by default (Settings > "Warn about calendar conflicts"); reads only a narrow window
  // around this one deadline and never for a project (projects have no reminder/calendar mirroring).
  const busyWarning = useBusyWarning(!isProject && hasDue && !!state.settings.calendarBusyCheckEnabled, hasDue ? due : null);
  const heading = isProject ? project ? 'Edit project' : 'New project' : task ? 'Edit task' : 'New task';

  // On-device only: a rough estimate of how long this task will take, from the user's own finished
  // tasks (never from anyone else's data, never sent anywhere). Recomputed as the draft's project and
  // tags change so it reflects what's actually being saved, not just the task as it was opened.
  const draftForEstimate: Task | null = isProject ? null : {
    id: task?.id ?? 'draft', title: title || 'Untitled', notes: '', projectId, status: 'todo', priority,
    dueAt: null, createdAt: task?.createdAt ?? new Date(now).toISOString(), updatedAt: task?.updatedAt ?? new Date(now).toISOString(),
    completedAt: null, reminderMode: 'normal', reminderLevel: 'gentle', snoozedUntil: null, lastRemindedAt: null,
    snoozeCount: 0, tags,
  };
  const estimate = useMemo(
    () => draftForEstimate ? estimateDuration(draftForEstimate, state.tasks, new Date(now)) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isProject, task?.id, projectId, tags, state.tasks, now],
  );

  // Rule-based, on-device first pass only (see domain/breakdown.ts) — reuses the existing
  // addMilestone action rather than a new one, and is only offered for a project that already
  // exists (a brand-new, unsaved project has no id yet for a milestone to attach to).
  async function suggestProjectSteps() {
    if (!project) return;
    const steps = suggestSteps(project, new Date(now));
    const added: Milestone[] = [];
    for (const step of steps) {
      const milestoneId = randomUUID();
      const ok = await dispatch({ type: 'addMilestone', id: project.id, milestoneId, title: step.title });
      if (ok) added.push({ id: milestoneId, title: step.title, targetAt: null, done: false });
    }
    if (added.length) setMilestones(prev => [...prev, ...added]);
  }

  // Cloud AI first pass — only offered when settings.aiAssistEnabled is on (see ai.available).
  // Shows the user exactly what would be sent (describePayload) and requires an explicit "Send"
  // tap before anything leaves the device; the on-device suggestProjectSteps above stays as the
  // fallback when AI is off. Reuses the same addMilestone action, never a wider one.
  function breakdownWithAi() {
    if (!project) return;
    const payload = ai.prepare('breakdown', project, new Date(now));
    if (!payload) { setAiError('This project needs a title and due date before AI can suggest steps.'); return; }
    setAiError('');
    Alert.alert('Send to AI?', ai.describe(payload), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => void runAiBreakdown(payload) },
    ]);
  }

  async function runAiBreakdown(payload: AiPayload) {
    if (!project) return;
    setAiBusy(true); setAiError('');
    const result = await ai.send(payload);
    setAiBusy(false);
    if (result.status !== 'success') { setAiError(result.message); return; }
    const steps = parseBreakdownSteps(result.value.text);
    if (!steps.length) { setAiError('The AI did not return any steps. Try again.'); return; }
    const added: Milestone[] = [];
    for (const title of steps) {
      const milestoneId = randomUUID();
      const ok = await dispatch({ type: 'addMilestone', id: project.id, milestoneId, title });
      if (ok) added.push({ id: milestoneId, title, targetAt: null, done: false });
    }
    if (added.length) setMilestones(prev => [...prev, ...added]);
  }

  async function save() {
    const cleanTitle = title.trim();
    if (!cleanTitle || (!isProject && mode === 'annoy' && !customIntervalValid)) return;
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
        reminderIntervalMinutes: customIntervalMinutes,
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
              // The task is gone from state, so useCalendarSync will never see it again to clean this
              // up itself — best-effort, mirroring the attachment cleanup just above.
              if (task?.calendarEventId) void deleteTaskEvent(task.calendarEventId);
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
              {estimate ? <Text style={styles.caption}>{estimateLabel(estimate)}</Text> : null}
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
              {!isProject && busyWarning.result?.busy ? <Text style={styles.caption}>Heads up — {busyWarning.result.count === 1 ? 'an event is' : `${busyWarning.result.count} events are`} already on your calendar around this time.</Text> : null}
              {!isProject && busyWarning.error ? <Text style={styles.caption}>{busyWarning.error}</Text> : null}
            </> : null}
            {isProject && project ? <View style={styles.wrap}>
              <Button quiet icon="bulb-outline" label="Suggest steps" onPress={suggestProjectSteps} />
              <Text style={styles.caption}>Simple, on-device suggestions — nothing about this project is sent anywhere.</Text>
            </View> : null}
            {isProject && project && ai.available ? <View style={styles.wrap}>
              <Button quiet icon="sparkles-outline" label={aiBusy ? 'Asking AI…' : 'Break down with AI'} disabled={aiBusy} onPress={breakdownWithAi} />
              <Text style={styles.caption}>Shows exactly what would be sent, and asks you to confirm, before anything leaves this device.</Text>
              {aiError ? <Text style={styles.error}>{aiError}</Text> : null}
            </View> : null}
            {isProject ? <MilestoneFields value={milestones} onChange={setMilestones} /> : null}
            {!isProject && hasDue ? <RepeatFields value={repeat} dueAt={due} onChange={setRepeat} /> : null}
            {!isProject ? <>
              <Field label="Reminder mode"><View style={styles.wrap}><Choice label="Normal" selected={mode === 'normal'} onPress={() => setMode('normal')} /><Choice label="Annoy me" selected={mode === 'annoy'} onPress={() => setMode('annoy')} /></View></Field>
              {mode === 'annoy' ? <Field label="How persistent?">
                <View style={styles.wrap}>{levels.map(value => <Choice key={value} label={`${value} · ${intervalText[value]}`} selected={level === value && !customInterval.trim()} onPress={() => { setLevel(value); setCustomInterval(''); }} />)}</View>
                <TextInput
                  accessibilityLabel="Custom reminder interval in minutes"
                  style={[styles.input, styles.customInterval]}
                  keyboardType="number-pad"
                  value={customInterval}
                  onChangeText={setCustomInterval}
                  placeholder={`Or a custom interval, ${MIN_CUSTOM_INTERVAL}-${MAX_CUSTOM_INTERVAL} min`}
                  placeholderTextColor={colors.textMuted}
                />
                {!customIntervalValid ? <Text style={styles.fieldError}>Custom interval must be between {MIN_CUSTOM_INTERVAL} and {MAX_CUSTOM_INTERVAL} minutes.</Text>
                  : <Text style={styles.caption}>{describeQueueCoverage(effectiveIntervalMinutes)}</Text>}
              </Field> : null}
              <SubtaskFields value={subtasks} onChange={setSubtasks} />
              <AttachmentFields value={attachments} originalIds={originalAttachmentIds} onChange={setAttachments} downloadAttachment={attachmentSync?.download} isPro={isPro} />
            </> : null}
            <Button label="Save" disabled={!title.trim() || saving || (!isProject && mode === 'annoy' && !customIntervalValid)} onPress={save} />
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
  fieldError: { color: colors.errorText, fontSize: 12, lineHeight: 18 },
  customInterval: { marginTop: spacing.sm },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
});
