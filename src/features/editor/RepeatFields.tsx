import { useState } from 'react';
import { Platform, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { RecurrenceFrequency, RecurrenceRule } from '../../../../src/domain/types';
import { Button, Choice, Field } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

interface Props {
  value: RecurrenceRule | null;
  /** The task's deadline. The series is anchored to it, so repeats need one. */
  dueAt: Date;
  onChange: (rule: RecurrenceRule | null) => void;
}

const frequencies: [RecurrenceFrequency, string][] = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
const units: Record<RecurrenceFrequency, string> = { daily: 'days', weekly: 'weeks', monthly: 'months' };
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function RepeatFields({ value, dueAt, onChange }: Props) {
  const [intervalText, setIntervalText] = useState(String(value?.interval ?? 1));
  const [picker, setPicker] = useState(false);

  const change = (patch: Partial<RecurrenceRule>) =>
    onChange({ frequency: 'daily', interval: 1, weekdays: [], basis: 'due', until: null, ...value, ...patch, anchorAt: dueAt.toISOString() });

  function setInterval(text: string) {
    setIntervalText(text.replace(/[^0-9]/g, ''));
    const parsed = Number.parseInt(text, 10);
    if (parsed >= 1 && parsed <= 365) change({ interval: parsed });
  }

  // An empty day list means "the deadline's own weekday", so edits start from that.
  const selectedDays = value?.weekdays.length ? value.weekdays : [dueAt.getDay()];
  const toggleDay = (day: number) =>
    change({ weekdays: selectedDays.includes(day) ? selectedDays.filter(d => d !== day) : [...selectedDays, day].sort((a, b) => a - b) });

  const until = value?.until ? new Date(value.until) : null;

  return <>
    <Field label="Repeats">
      <View style={styles.wrap}>
        <Choice label="Never" selected={!value} onPress={() => onChange(null)} />
        {frequencies.map(([frequency, label]) => <Choice key={frequency} label={label} selected={value?.frequency === frequency} onPress={() => change({ frequency })} />)}
      </View>
    </Field>
    {value ? <>
      <Field label="Repeat every">
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Repeat interval"
            keyboardType="number-pad"
            maxLength={3}
            style={styles.interval}
            value={intervalText}
            onChangeText={setInterval}
            onBlur={() => setIntervalText(String(value.interval))}
          />
          <Text style={styles.unit}>{units[value.frequency]}</Text>
        </View>
      </Field>
      {value.frequency === 'weekly' ? (
        <Field label="On these days">
          <View style={styles.wrap}>{weekdays.map((label, day) => <Choice key={label} label={label} selected={selectedDays.includes(day)} onPress={() => toggleDay(day)} />)}</View>
        </Field>
      ) : null}
      <Field label="Count the next one from">
        <View style={styles.wrap}>
          <Choice label="The deadline" selected={value.basis === 'due'} onPress={() => change({ basis: 'due' })} />
          <Choice label="When I finish it" selected={value.basis === 'completion'} onPress={() => change({ basis: 'completion' })} />
        </View>
      </Field>
      <View style={styles.between}>
        <Text style={styles.fieldLabel}>Stop repeating on a date</Text>
        <Switch
          accessibilityLabel="Stop repeating on a date"
          value={until !== null}
          onValueChange={on => change({ until: on ? new Date(dueAt.getTime() + 30 * 86_400_000).toISOString() : null })}
          trackColor={{ true: colors.accent }}
        />
      </View>
      {until ? <>
        <Button quiet label={`Last one by ${until.toLocaleDateString()}`} icon="calendar-outline" onPress={() => setPicker(true)} />
        {picker ? <DateTimePicker value={until} mode="date" themeVariant="dark" onChange={(_, selected) => { if (Platform.OS === 'android') setPicker(false); if (selected) change({ until: selected.toISOString() }); }} /> : null}
      </> : null}
    </> : null}
  </>;
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  interval: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 14, color: colors.text, fontSize: 16, minHeight: 50, minWidth: 80, textAlign: 'center' },
  unit: { color: colors.textMuted, fontSize: 15 },
  fieldLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
