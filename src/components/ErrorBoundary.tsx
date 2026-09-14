import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme';

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled Done Yet? render error', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.heading}>Let’s try that again.</Text>
      <Text style={styles.body}>Something interrupted this screen. Your saved data is still on this device.</Text>
      <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>Reload screen</Text>
      </Pressable>
    </View>;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.xxl, justifyContent: 'center', gap: 20 },
  heading: { color: colors.text, fontSize: 24, fontWeight: '700' },
  body: { color: colors.textMuted, fontSize: 16, lineHeight: 24 },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent, padding: spacing.lg, borderRadius: radii.sm },
  buttonText: { color: colors.background, fontWeight: '700' },
  pressed: { opacity: 0.65 },
});
