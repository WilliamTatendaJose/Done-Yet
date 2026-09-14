import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Button, Choice } from '../../components/ui';
import { colors, radii, spacing } from '../../theme';

const PRESETS = [5, 15, 25, 45];

interface Props {
  /** Highlights a chip as the current choice. Omit for a one-shot action (e.g. "start now for
   * this many minutes") where nothing is actually being saved as a preference. */
  selected?: number;
  onSelect: (minutes: number) => void;
}

/** Shared 5/15/25/45-plus-custom focus-length picker (Part 1 of the configurable-session work).
 * Every tap — a preset chip or a confirmed custom value — calls onSelect once with an integer
 * already narrowed to 1-120; the reducer (startFocus / the settings action) still validates
 * independently, so this is a convenience, not the source of truth for the bound. */
export function FocusDurationChips({ selected, onSelect }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const customSelected = selected !== undefined && !PRESETS.includes(selected);

  function confirmCustom() {
    const minutes = Math.trunc(Number(customValue));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) return;
    onSelect(minutes);
    setCustomOpen(false);
    setCustomValue('');
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {PRESETS.map(minutes => <Choice key={minutes} label={`${minutes} min`} selected={selected === minutes} onPress={() => onSelect(minutes)} />)}
        <Choice label={customSelected ? `Custom · ${selected} min` : 'Custom'} selected={customOpen || customSelected} onPress={() => setCustomOpen(value => !value)} />
      </View>
      {customOpen ? <View style={styles.row}>
        <TextInput
          accessibilityLabel="Custom focus length in minutes"
          style={styles.input}
          keyboardType="number-pad"
          value={customValue}
          onChangeText={setCustomValue}
          placeholder="1-120"
          placeholderTextColor={colors.textMuted}
        />
        <Button quiet label="Set" onPress={confirmCustom} />
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 15, minWidth: 90 },
});
