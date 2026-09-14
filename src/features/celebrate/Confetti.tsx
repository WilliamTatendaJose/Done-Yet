import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../../theme';

export type CelebrationVariant = 'task' | 'badge';

interface Props {
  variant: CelebrationVariant;
  /** Shown for a badge celebration (its title) and in the reduce-motion fallback for either variant. */
  message?: string;
  onDone: () => void;
}

const PIECE_COLORS = [colors.accent, colors.text, colors.warning, colors.textMuted];
const PIECE_COUNT: Record<CelebrationVariant, number> = { task: 9, badge: 16 };
const ANIMATION_MS: Record<CelebrationVariant, number> = { task: 900, badge: 1500 };
const AUTO_DISMISS_MS: Record<CelebrationVariant, number> = { task: 1300, badge: 2400 };
const REDUCED_DISMISS_MS = 1400;

/**
 * A brief, calm completion celebration. Understated by design — this app's whole voice is quiet, so
 * a task completion gets a handful of small pieces for under a second and a badge gets a slightly
 * fuller burst. Never blocks interaction: the overlay is `pointerEvents="none"` throughout, holds no
 * focus, and always finishes on its own via `onDone`.
 *
 * Accessibility is not optional here: when the OS reports reduce-motion, no animation runs at all —
 * a short static confirmation pill appears and clears itself instead. The reduce-motion check is
 * re-read on mount only (a value that can change while this is showing is not worth chasing for
 * something this brief), but a live listener still updates it if it flips mid-display.
 */
export function Confetti({ variant, message, onDone }: Props) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (!cancelled) setReduceMotion(value); })
      .catch(() => { if (!cancelled) setReduceMotion(false); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => setReduceMotion(value));
    return () => { cancelled = true; subscription.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return undefined; // wait until we know, so we never animate by mistake
    const timer = setTimeout(onDone, reduceMotion ? REDUCED_DISMISS_MS : AUTO_DISMISS_MS[variant]);
    return () => clearTimeout(timer);
  }, [reduceMotion, variant, onDone]);

  if (reduceMotion === null) return null;

  return (
    <View
      pointerEvents="none"
      style={styles.overlay}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {reduceMotion ? <CalmConfirmation variant={variant} message={message} /> : <AnimatedBurst variant={variant} />}
    </View>
  );
}

function CalmConfirmation({ variant, message }: { variant: CelebrationVariant; message?: string }) {
  const text = message ?? (variant === 'badge' ? 'Badge earned' : 'Nice work');
  return (
    <View style={styles.calmWrap}>
      <View style={styles.calmPill}><Text style={styles.calmText}>{text}</Text></View>
    </View>
  );
}

function AnimatedBurst({ variant }: { variant: CelebrationVariant }) {
  const count = PIECE_COUNT[variant];
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: i,
    color: PIECE_COLORS[i % PIECE_COLORS.length],
    left: count <= 1 ? 50 : 6 + (i * (88 / (count - 1))),
    drift: (i % 2 === 0 ? 1 : -1) * (16 + (i % 4) * 9),
    rotate: (i % 2 === 0 ? 1 : -1) * (130 + i * 13),
    value: new Animated.Value(0),
  })), [count]);

  useEffect(() => {
    const animations = pieces.map(piece => Animated.timing(piece.value, {
      toValue: 1,
      duration: ANIMATION_MS[variant],
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }));
    const burst = Animated.stagger(variant === 'badge' ? 28 : 16, animations);
    burst.start();
    return () => burst.stop();
  }, [pieces, variant]);

  return (
    <View style={styles.burstWrap}>
      {pieces.map(piece => {
        const translateY = piece.value.interpolate({ inputRange: [0, 1], outputRange: [0, 190] });
        const translateX = piece.value.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] });
        const rotate = piece.value.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.rotate}deg`] });
        const opacity = piece.value.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View
            key={piece.id}
            style={[
              styles.piece,
              {
                left: `${piece.left}%`,
                backgroundColor: piece.color,
                opacity,
                transform: [{ translateY }, { translateX }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  burstWrap: { position: 'absolute', top: 80, left: 0, right: 0, height: 200 },
  piece: { position: 'absolute', top: 0, width: 7, height: 13, borderRadius: 2 },
  calmWrap: { position: 'absolute', top: 90, left: 0, right: 0, alignItems: 'center' },
  calmPill: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.round,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  calmText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
