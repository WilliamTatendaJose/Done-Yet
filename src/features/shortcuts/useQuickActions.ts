import { useEffect, useRef } from 'react';
import * as QuickActions from 'expo-quick-actions';
import type { ShortcutAction } from './deepLink';

/**
 * Registers the launcher long-press shortcuts (which is also what Google Assistant surfaces)
 * and reports the one the user picked. The ids match the `doneyet://` deep links so a shortcut,
 * an Assistant intent and a hand-opened link all land on the same handler in useShortcutLink.
 */
const ITEMS: QuickActions.Action[] = [
  { id: 'add-task', title: 'Add a task', subtitle: 'Capture the next small step', icon: 'compose', params: { href: 'doneyet://add-task' } },
  { id: 'focus', title: 'Start a focus session', subtitle: 'Five minutes on the next thing', icon: 'play', params: { href: 'doneyet://focus' } },
];
const toAction = (id: string | undefined): ShortcutAction | null => (id === 'add-task' || id === 'focus' ? id : null);

export function useQuickActions(onAction: (action: ShortcutAction) => void) {
  const handler = useRef(onAction); handler.current = onAction;
  useEffect(() => {
    // Registration is best-effort: an unsupported launcher must never break app start.
    void QuickActions.isSupported()
      .then(supported => (supported ? QuickActions.setItems(ITEMS) : undefined))
      .catch(() => undefined);
    // A cold start triggered by a shortcut exposes it here rather than through the listener.
    const initial = toAction(QuickActions.initial?.id);
    if (initial) handler.current(initial);
    const subscription = QuickActions.addListener(action => {
      const parsed = toAction(action?.id);
      if (parsed) handler.current(parsed);
    });
    return () => { subscription.remove(); };
  }, []);
}
