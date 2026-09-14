import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tabs, type TabName } from '../navigation';
import { colors } from '../theme';

export function AppTabBar({ selected, onSelect }: { selected: TabName; onSelect: (tab: TabName) => void }) {
  return <SafeAreaView edges={['bottom']} style={styles.bar}>
    <View style={styles.row}>{tabs.map(tab => <Pressable
      key={tab.name}
      style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      accessibilityRole="tab"
      accessibilityState={{ selected: selected === tab.name }}
      accessibilityLabel={tab.name}
      onPress={() => onSelect(tab.name)}
    >
      <Ionicons name={tab.icon} size={23} color={selected === tab.name ? colors.accent : colors.textMuted} />
      <Text style={[styles.label, selected === tab.name && styles.selected]}>{tab.name}</Text>
    </Pressable>)}</View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  bar: { backgroundColor: '#171D15', borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row' },
  tab: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 5 },
  label: { fontSize: 11, color: colors.textMuted },
  selected: { color: colors.accent },
  pressed: { opacity: 0.65 },
});
