import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Project } from '../../../../src/domain/types';
import { projectPacing } from '../../../../src/domain/engine';
import { milestoneProgress } from '../../../../src/domain/milestones';
import { parseProgressPercent } from '../../../../src/domain/aiResponse';
import type { AiAssistState } from '../../cloud/useAiAssist';
import { Button, IconButton } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  project: Project;
  now: number;
  onEdit: (project: Project) => void;
  onProgressChange: (id: string, progress: number) => void;
  ai: AiAssistState;
}

export function ProjectCard({ project, now, onEdit, onProgressChange, ai }: Props) {
  const pacing = projectPacing(project, new Date(now));
  const milestones = milestoneProgress(project.milestones);
  const [sentence, setSentence] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [proposed, setProposed] = useState<number | null>(null);

  // Reading a typed status update never applies a progress change on its own — it only proposes
  // one, which the user must confirm with a second, explicit tap (mirrors the escalation-suggestion
  // pattern in useEscalationSuggestions: suggest, never auto-apply).
  function readUpdateWithAi() {
    const payload = ai.prepare('progress-parse', sentence, new Date(now));
    if (!payload) { setAiError('Type a short update first.'); return; }
    setAiError(''); setProposed(null);
    ai.confirm(payload, () => void runReadUpdate());
  }

  async function runReadUpdate() {
    const payload = ai.prepare('progress-parse', sentence, new Date(now));
    if (!payload) return;
    setAiBusy(true); setAiError(''); setProposed(null);
    const result = await ai.send(payload);
    setAiBusy(false);
    if (result.status !== 'success') { setAiError(result.message); return; }
    const percent = parseProgressPercent(result.value.text);
    if (percent === null) { setAiError("The AI's answer wasn't a clear percentage. Try rephrasing."); return; }
    setProposed(percent);
  }

  function applyProposed() {
    if (proposed === null) return;
    onProgressChange(project.id, proposed);
    setProposed(null); setSentence('');
  }

  return <View style={styles.card}>
    <View style={styles.between}><Text style={[styles.accentLabel, pacing.atRisk && styles.warning]}>{project.progress === 100 ? 'FINISHED' : pacing.atRisk ? 'LET’S FIND SOME MOMENTUM' : 'KEEP MOVING'}</Text><IconButton name="create-outline" label={`Edit ${project.title}`} onPress={() => onEdit(project)} /></View>
    <Text style={styles.title}>{project.title}</Text>
    <Text style={styles.caption}>Due {new Date(project.dueAt).toLocaleDateString()}</Text>
    {milestones ? (
      <View style={styles.between}>
        <Text style={styles.caption}>{milestones.done}/{milestones.total} milestones</Text>
        {milestones.percent !== project.progress ? (
          <Button quiet label={`Set progress to ${milestones.percent}%`} onPress={() => onProgressChange(project.id, milestones.percent)} />
        ) : null}
      </View>
    ) : null}
    <View style={styles.sectionHead}><Text style={styles.caption}>Work completed</Text><Text style={styles.value}>{project.progress}%</Text></View>
    <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: project.progress }} style={styles.track}><View style={[styles.fill, { width: `${project.progress}%` }]} /></View>
    <View style={styles.between}><Text style={styles.caption}>Time elapsed</Text><Text style={styles.caption}>{Math.round(pacing.elapsedPercent)}%</Text></View>
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Project time elapsed" accessibilityValue={{ min: 0, max: 100, now: Math.round(pacing.elapsedPercent) }} style={styles.track}><View style={[styles.fill, styles.elapsed, { width: `${pacing.elapsedPercent}%` }]} /></View>
    <View style={styles.between}><Button quiet label="− 10%" onPress={() => onProgressChange(project.id, project.progress - 10)} /><Text style={styles.caption}>Update progress</Text><Button quiet label="+ 10%" onPress={() => onProgressChange(project.id, project.progress + 10)} /></View>
    {ai.available ? <View style={styles.aiBlock}>
      <Text style={styles.caption}>Describe progress in a sentence and let AI propose a percentage — it never applies on its own.</Text>
      <TextInput
        accessibilityLabel={`Describe progress on ${project.title}`}
        style={styles.input}
        value={sentence}
        onChangeText={setSentence}
        placeholder="e.g. finished the outline, still need refs"
        placeholderTextColor={colors.textMuted}
      />
      <Button quiet label={aiBusy ? 'Asking AI…' : 'Read update with AI'} disabled={aiBusy || !sentence.trim()} onPress={readUpdateWithAi} />
      {aiError ? <Text style={styles.errorText}>{aiError}</Text> : null}
      {proposed !== null ? <View style={styles.between}>
        <Text style={styles.caption}>AI read this as {proposed}% complete.</Text>
        <Button quiet label={`Set progress to ${proposed}%`} onPress={applyProposed} />
      </View> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.lg, padding: 20, gap: spacing.md, marginTop: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xs },
  accentLabel: { color: colors.accent, fontSize: 11, letterSpacing: 1.2, fontWeight: '700', flexShrink: 1 },
  warning: { color: colors.warning },
  title: { color: colors.text, fontSize: 23, lineHeight: 30, fontWeight: '600', letterSpacing: -0.5 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  value: { color: colors.text, fontWeight: '700', fontSize: 16 },
  track: { height: 6, borderRadius: 6, overflow: 'hidden', backgroundColor: '#364030' },
  fill: { height: 6, backgroundColor: colors.accent },
  elapsed: { backgroundColor: colors.textMuted },
  aiBlock: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.xs },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, color: colors.text, fontSize: 14 },
  errorText: { color: colors.errorText, fontSize: 12, lineHeight: 18 },
});
