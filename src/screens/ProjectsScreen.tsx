import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { Project } from '../../../src/domain/types';
import { Button } from '../components/ui';
import { ProjectCard } from '../features/projects/ProjectCard';
import { colors, spacing } from '../theme';

interface Props {
  projects: Project[];
  now: number;
  onEditProject: (project: Project) => void;
  onProgressChange: (id: string, progress: number) => void;
  onAddProject: () => void;
}

export function ProjectsScreen({ projects, now, onEditProject, onProgressChange, onAddProject }: Props) {
  return <FlatList
    data={projects}
    keyExtractor={project => project.id}
    contentContainerStyle={styles.content}
    ListHeaderComponent={<View style={styles.intro}><Text style={styles.eyebrow}>THE BIGGER PICTURE</Text><Text style={styles.hero}>Pace, not panic.</Text><Text style={styles.body}>Small steps keep the deadline manageable.</Text></View>}
    renderItem={({ item }) => <ProjectCard project={item} now={now} onEdit={onEditProject} onProgressChange={onProgressChange} />}
    ListEmptyComponent={<Text style={styles.body}>Create a project to track progress against a deadline.</Text>}
    ListFooterComponent={<Button quiet label="Start a project" icon="add" onPress={onAddProject} />}
  />;
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  intro: { gap: spacing.md },
  eyebrow: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  hero: { color: colors.text, fontSize: 35, lineHeight: 41, fontWeight: '700', letterSpacing: -1.3 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
});
