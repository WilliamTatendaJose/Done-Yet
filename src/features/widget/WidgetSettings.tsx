import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';
import { Button } from '../../components/ui';
import { colors, spacing } from '../../theme';
import { WIDGET_NAME } from './constants';

/**
 * Asks the launcher to place the "Done Yet?" widget, so adding it is one button rather than a
 * long-press on the wallpaper and a hunt through the widget picker — which is where most people
 * never find it.
 *
 * Android-only, and best-effort: `requestPinWidget` resolves false on a launcher that does not
 * support pinning (and on anything before Android 8), which is not a failure worth an error
 * dialog — it just means the manual route is the only route, so that is what we explain. A true
 * result means the launcher accepted the request, not that the user said yes to it, so nothing here
 * claims the widget was added.
 */
export function WidgetSettings() {
  const [asking, setAsking] = useState(false);
  if (Platform.OS !== 'android') return null;

  async function addWidget() {
    setAsking(true);
    try {
      if (!await requestPinWidget({ widgetName: WIDGET_NAME })) {
        Alert.alert('Add it from the home screen', 'This launcher cannot add widgets for you. Press and hold an empty part of your home screen, choose Widgets, and pick "Done Yet?".');
      }
    } catch {
      Alert.alert('Could not open the widget prompt', 'Please try again, or add the widget from your home screen.');
    } finally {
      setAsking(false);
    }
  }

  return <View style={styles.card}>
    <Text style={styles.title}>Home screen widget</Text>
    <Text style={styles.caption}>Keeps your next task on the home screen, with Done and a 15-minute snooze you can press without opening the app. Drag it taller and it turns into a list of what is due.</Text>
    <Button label="Add to home screen" icon="add-circle-outline" onPress={addWidget} disabled={asking} quiet />
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '700' },
  caption: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
});
