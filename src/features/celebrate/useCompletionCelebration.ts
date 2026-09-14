import { useEffect, useRef, useState } from 'react';
import { badges, type Badge } from '../../../../src/domain/badges';
import type { AppState } from '../../../../src/domain/types';
import type { CelebrationVariant } from './Confetti';

export interface Celebration { variant: CelebrationVariant; badge?: Badge }

/**
 * Watches state for two things worth a brief celebration: a task newly turning `done`, and a badge
 * newly becoming earned (see `src/domain/badges.ts` — nothing here is persisted, both are recomputed
 * from `state` each time it changes). This is deliberately state-driven rather than tied to one
 * dispatch call site, so it fires the same way whether completion happened from Today, Tasks, or the
 * focus modal's "Finished this step" button, without each of those needing to know about celebration.
 *
 * A badge newly earned takes priority over the plain task confetti in the same tick — earning a badge
 * is the more noteworthy moment. Nothing fires on first load: the refs only start comparing after the
 * first snapshot of state is seen, so pre-existing completions and badges never trigger a celebration
 * just because the app opened.
 */
export function useCompletionCelebration(state: AppState | null, now: number): {
  celebration: Celebration | null;
  clear: () => void;
} {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const seenDoneIds = useRef<Set<string> | null>(null);
  const seenBadgeIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!state) return;
    const doneIds = new Set(state.tasks.filter(task => task.status === 'done').map(task => task.id));
    const currentBadges = badges(state.tasks, state.projects, new Date(now));
    const earnedIds = new Set(currentBadges.filter(badge => badge.earned).map(badge => badge.id));

    if (seenDoneIds.current && seenBadgeIds.current) {
      const newlyEarned = currentBadges.find(badge => badge.earned && !seenBadgeIds.current!.has(badge.id));
      if (newlyEarned) {
        setCelebration({ variant: 'badge', badge: newlyEarned });
      } else {
        const newlyCompleted = [...doneIds].some(id => !seenDoneIds.current!.has(id));
        if (newlyCompleted) setCelebration({ variant: 'task' });
      }
    }

    seenDoneIds.current = doneIds;
    seenBadgeIds.current = earnedIds;
    // `now` deliberately excluded: re-deriving badges every clock tick is unnecessary here — only
    // task/project changes can newly earn one, so only those should re-run this comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return { celebration, clear: () => setCelebration(null) };
}
