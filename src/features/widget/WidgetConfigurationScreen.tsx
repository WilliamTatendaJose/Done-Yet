import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';
import type { Project } from '../../../../src/domain/types';
import type { WidgetScope } from '../../../../src/domain/widget';
import { widgetView } from '../../../../src/domain/widget';
import { decodeState } from '../../../../src/state/storage';
import { repository } from '../../state/database';
import { Button, Choice } from '../../components/ui';
import { colors, spacing } from '../../theme';
import { NextTaskWidget } from './NextTaskWidget';
import { widgetScope } from './widgetScope';

/** Matches WidgetScope.projectId: undefined is everything, null is tasks in no project. */
type Selection = { projectId?: string | null };

const same = (a: Selection, b: Selection) => a.projectId === b.projectId;

/**
 * The screen Android opens when a widget is configured — on first add, and again from the
 * launcher's "configure" on a long-press (see app.json's `widgetFeatures`). It scopes this one
 * widget to a project, so someone can keep a widget for one piece of work beside a general one.
 *
 * It reads the snapshot straight from the repository rather than the running app's store: the
 * configuration activity can be started with no app mounted behind it, exactly like the headless
 * task. Nothing here writes task state — only this widget's own scope row.
 *
 * Cancelling matters: for a widget being added for the first time, Android discards it unless
 * `setResult('ok')` is called, so the two exits are genuinely different and both must be offered.
 */
export function WidgetConfigurationScreen({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [saving, setSaving] = useState(false);

  // Preview exactly what this widget will look like at its real size, so the choice is visible
  // rather than described.
  const preview = useCallback(async (scope: WidgetScope) => {
    try {
      const raw = await repository.read();
      const state = raw ? decodeState(raw) : null;
      if (!state) return;
      const size = { width: widgetInfo.width, height: widgetInfo.height };
      renderWidget(<NextTaskWidget view={widgetView(state, new Date(), size, scope)} />);
    } catch {
      // A preview is a nicety; failing to draw one must not block configuring the widget.
    }
  }, [renderWidget, widgetInfo.height, widgetInfo.width]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [raw, stored] = await Promise.all([repository.read().catch(() => null), widgetScope.read(widgetInfo.widgetId)]);
      if (!alive) return;
      let loaded: Project[] = [];
      try {
        loaded = raw ? decodeState(raw).projects : [];
      } catch {
        loaded = [];
      }
      setProjects(loaded);
      setSelection(stored);
      void preview(stored);
    })();
    return () => { alive = false; };
  }, [widgetInfo.widgetId, preview]);

  function choose(next: Selection) {
    setSelection(next);
    void preview(next);
  }

  async function save() {
    setSaving(true);
    try {
      await widgetScope.write(widgetInfo.widgetId, selection);
    } catch {
      // The widget is still worth adding unscoped; it will simply show everything.
    } finally {
      setResult('ok');
    }
  }

  if (projects === null) {
    return <View style={[styles.screen, styles.centered]}><ActivityIndicator color={colors.accent} /></View>;
  }

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.eyebrow}>HOME SCREEN WIDGET</Text>
    <Text style={styles.hero}>What should it watch?</Text>
    <Text style={styles.caption}>This widget only. Add another and scope it differently if you want both.</Text>
    <View style={styles.choices}>
      <Choice label="Everything" selected={same(selection, {})} onPress={() => choose({})} />
      <Choice label="No project" selected={same(selection, { projectId: null })} onPress={() => choose({ projectId: null })} />
      {projects.map(project => (
        <Choice key={project.id} label={project.title} selected={same(selection, { projectId: project.id })} onPress={() => choose({ projectId: project.id })} />
      ))}
    </View>
    <View style={styles.actions}>
      <Button label="Save" onPress={save} disabled={saving} />
      <Button label="Cancel" quiet onPress={() => setResult('cancel')} disabled={saving} />
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.xl, gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 },
  hero: { color: colors.text, fontSize: 26, fontWeight: '800' },
  caption: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
});
