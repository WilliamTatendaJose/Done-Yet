import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Task } from '../../../src/domain/types';
import { allTags } from '../../../src/domain/tags';
import { emptyQuery, filterTasks, groupByDue, type TaskBucket, type TaskQuery, type TaskSort, type TaskStatusFilter } from '../../../src/domain/query';
import { addMonths, localDateString, monthGrid, tasksOnDate, type CalendarDay } from '../../../src/domain/calendar';
import { Button, Choice, Field, IconButton } from '../components/ui';
import { TaskRow } from '../features/tasks/TaskRow';
import { colors, radii, spacing } from '../theme';

interface Props {
  now: number;
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onToggleTask: (id: string) => void;
  onStartFocus: (id: string) => void;
}

type ViewMode = 'list' | 'calendar';
type Row = { kind: 'header'; bucket: TaskBucket } | { kind: 'task'; task: Task } | { kind: 'day-empty' };

const statusChoices: { label: string; value: TaskStatusFilter }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Done', value: 'done' },
  { label: 'All', value: 'all' },
];
const sortChoices: { label: string; value: TaskSort }[] = [
  { label: 'Deadline', value: 'due' },
  { label: 'Priority', value: 'priority' },
  { label: 'Newest', value: 'created' },
  { label: 'Title', value: 'title' },
];
const viewChoices: { label: string; value: ViewMode }[] = [
  { label: 'List', value: 'list' },
  { label: 'Calendar', value: 'calendar' },
];
const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const dayHeadingLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const dayA11yLabel = (day: CalendarDay) => {
  const date = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return day.count ? `${date}, ${day.count} task${day.count === 1 ? '' : 's'} due` : date;
};

export function TasksScreen({ now, tasks, onEditTask, onToggleTask, onStartFocus }: Props) {
  const [query, setQuery] = useState<TaskQuery>(emptyQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mode, setMode] = useState<ViewMode>('list');
  const nowDate = useMemo(() => new Date(now), [now]);
  const [cal, setCal] = useState(() => ({ year: nowDate.getFullYear(), month: nowDate.getMonth(), selected: localDateString(nowDate) }));
  const tagOptions = useMemo(() => allTags(tasks), [tasks]);
  const filtered = useMemo(() => filterTasks(tasks, query), [tasks, query]);
  const activeFilterCount = (query.status !== emptyQuery.status ? 1 : 0) + (query.sort !== emptyQuery.sort ? 1 : 0) + query.tags.length;

  const rows = useMemo<Row[]>(() => {
    if (query.sort !== 'due') return filtered.map(task => ({ kind: 'task' as const, task }));
    return groupByDue(filtered, nowDate).flatMap(bucket => [
      { kind: 'header' as const, bucket },
      ...bucket.tasks.map(task => ({ kind: 'task' as const, task })),
    ]);
  }, [filtered, query.sort, nowDate]);

  const grid = useMemo(() => monthGrid(cal.year, cal.month, filtered, nowDate), [cal.year, cal.month, filtered, nowDate]);
  const dayTasks = useMemo(() => tasksOnDate(filtered, cal.selected), [filtered, cal.selected]);
  const calendarRows = useMemo<Row[]>(() => dayTasks.length ? dayTasks.map(task => ({ kind: 'task' as const, task })) : [{ kind: 'day-empty' as const }], [dayTasks]);

  const goMonth = (delta: number) => setCal(c => ({ ...c, ...addMonths(c.year, c.month, delta) }));
  const goToday = () => { const today = new Date(now); setCal({ year: today.getFullYear(), month: today.getMonth(), selected: localDateString(today) }); };
  const selectDay = (date: string) => setCal(c => ({ ...c, selected: date }));

  const toggleTag = (tag: string) => setQuery(q => ({
    ...q,
    tags: q.tags.some(t => t.toLowerCase() === tag.toLowerCase())
      ? q.tags.filter(t => t.toLowerCase() !== tag.toLowerCase())
      : [...q.tags, tag],
  }));

  return <FlatList
    data={mode === 'list' ? rows : calendarRows}
    keyExtractor={row => row.kind === 'header' ? `bucket:${row.bucket.key}` : row.kind === 'day-empty' ? 'day-empty' : row.task.id}
    contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled"
    ListHeaderComponent={<View style={styles.header}>
      <Text style={styles.eyebrow}>TASKS</Text>
      <Text style={styles.hero}>Everything, sorted.</Text>
      <View style={styles.wrap}>
        {viewChoices.map(c => <Choice key={c.value} label={c.label} selected={mode === c.value} onPress={() => setMode(c.value)} />)}
      </View>
      <View style={styles.searchRow}>
        <TextInput
          accessibilityLabel="Search tasks"
          style={styles.input}
          value={query.search}
          onChangeText={text => setQuery(q => ({ ...q, search: text }))}
          placeholder="Search title, notes, tags…"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
        />
        {query.search ? <IconButton name="close-circle" label="Clear search" onPress={() => setQuery(q => ({ ...q, search: '' }))} /> : null}
        <View>
          <IconButton name="options-outline" label="Filters" color={filtersOpen ? colors.accent : colors.text} onPress={() => setFiltersOpen(v => !v)} />
          {!filtersOpen && activeFilterCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{activeFilterCount}</Text></View> : null}
        </View>
      </View>
      {filtersOpen ? <View style={styles.filters}>
        <Field label="Status"><View style={styles.wrap}>
          {statusChoices.map(c => <Choice key={c.value} label={c.label} selected={query.status === c.value} onPress={() => setQuery(q => ({ ...q, status: c.value }))} />)}
        </View></Field>
        {mode === 'list' ? <Field label="Sort"><View style={styles.wrap}>
          {sortChoices.map(c => <Choice key={c.value} label={c.label} selected={query.sort === c.value} onPress={() => setQuery(q => ({ ...q, sort: c.value }))} />)}
        </View></Field> : null}
        {tagOptions.length ? <Field label="Tags"><View style={styles.wrap}>
          {tagOptions.map(tag => <Choice key={tag} label={tag} selected={query.tags.some(t => t.toLowerCase() === tag.toLowerCase())} onPress={() => toggleTag(tag)} />)}
        </View></Field> : null}
      </View> : null}
      {mode === 'calendar' ? <View style={styles.calendar}>
        <View style={styles.calendarNav}>
          <IconButton name="chevron-back" label="Previous month" onPress={() => goMonth(-1)} />
          <Text style={styles.monthLabel}>{grid.label}</Text>
          <IconButton name="chevron-forward" label="Next month" onPress={() => goMonth(1)} />
        </View>
        <Button quiet label="Today" onPress={goToday} />
        <View style={styles.weekRow}>
          {weekdayLabels.map((label, i) => <Text key={i} style={styles.weekdayLabel}>{label}</Text>)}
        </View>
        {grid.weeks.map((week, i) => <View key={i} style={styles.weekRow}>
          {week.map(day => {
            const selected = day.date === cal.selected;
            return <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityLabel={dayA11yLabel(day)}
              accessibilityState={{ selected }}
              onPress={() => selectDay(day.date)}
              style={[styles.dayCell, day.isToday && styles.dayCellToday, selected && styles.dayCellSelected]}
            >
              <Text style={[styles.dayNumber, !day.inMonth && styles.dayNumberMuted, day.hasOverdue && styles.dayNumberOverdue]}>{day.day}</Text>
              {day.count > 0 ? <View style={[styles.dayBadge, day.hasOverdue && styles.dayBadgeOverdue]}><Text style={styles.dayBadgeText}>{day.count}</Text></View> : null}
            </Pressable>;
          })}
        </View>)}
        <View style={styles.sectionHead}><Text style={styles.eyebrow}>{dayHeadingLabel(cal.selected).toUpperCase()}</Text><Text style={styles.caption}>{dayTasks.length}</Text></View>
      </View> : null}
    </View>}
    renderItem={({ item }) => item.kind === 'header'
      ? <View style={styles.sectionHead}><Text style={styles.eyebrow}>{item.bucket.label.toUpperCase()}</Text><Text style={styles.caption}>{item.bucket.tasks.length}</Text></View>
      : item.kind === 'day-empty'
      ? <Text style={styles.body}>Nothing due this day.</Text>
      : <TaskRow task={item.task} onEdit={onEditTask} onToggle={onToggleTask} onStartFocus={onStartFocus} />}
    ListEmptyComponent={mode === 'list' ? <View style={styles.empty}>
      <Text style={styles.body}>{tasks.length === 0 ? 'Nothing here yet. Add your first task to get started.' : 'No tasks match these filters.'}</Text>
      {tasks.length > 0 ? <Button quiet label="Clear filters" onPress={() => setQuery(emptyQuery)} /> : null}
    </View> : null}
  />;
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, paddingBottom: 36, gap: spacing.md },
  header: { gap: spacing.md },
  eyebrow: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.6, fontWeight: '600' },
  hero: { color: colors.text, fontSize: 35, lineHeight: 41, fontWeight: '700', letterSpacing: -1.3 },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 23 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, color: colors.text, fontSize: 16, minHeight: 50 },
  filters: { backgroundColor: colors.surface, borderRadius: 16, borderColor: colors.border, borderWidth: 1, padding: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { position: 'absolute', top: -2, right: -2, backgroundColor: colors.accent, borderRadius: 999, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: colors.background, fontSize: 10, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.xs },
  empty: { gap: spacing.md, paddingVertical: spacing.xl, alignItems: 'flex-start' },
  calendar: { gap: spacing.sm },
  calendarNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  monthLabel: { color: colors.text, fontSize: 17, fontWeight: '700', minWidth: 160, textAlign: 'center' },
  weekRow: { flexDirection: 'row' },
  weekdayLabel: { flex: 1, textAlign: 'center', color: colors.textMuted, fontSize: 11, fontWeight: '700', paddingVertical: spacing.xs },
  dayCell: { flex: 1, minHeight: 44, minWidth: 44, margin: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.sm },
  dayCellToday: { borderWidth: 1, borderColor: colors.accent },
  dayCellSelected: { backgroundColor: colors.surfaceStrong },
  dayNumber: { color: colors.text, fontSize: 14, fontWeight: '600' },
  dayNumberMuted: { color: colors.textMuted, opacity: 0.5 },
  dayNumberOverdue: { color: colors.warning },
  dayBadge: { position: 'absolute', top: 2, right: 3, backgroundColor: colors.accent, borderRadius: 999, minWidth: 14, height: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  dayBadgeOverdue: { backgroundColor: colors.warning },
  dayBadgeText: { color: colors.background, fontSize: 9, fontWeight: '700' },
});
