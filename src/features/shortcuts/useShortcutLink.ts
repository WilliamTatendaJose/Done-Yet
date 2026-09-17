import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { parseShortcutUrl, type ShortcutAction } from './deepLink';

/**
 * Listens for the `doneyet://` deep links (see deepLink.ts for the set) — what a real Android app
 * shortcut, an Assistant intent built on one, or a tap on a region of the home-screen widget opens
 * — and for a link the app was already launched with cold. See features/shortcuts (and the final report) for why the shortcuts that
 * would target these links are not registered: doing so needs either a config-plugin entry in
 * app.json or a hand-edit of the generated AndroidManifest.xml, and this task was told not to touch
 * either. This hook is the half of the feature that does not require that: once such a shortcut (or
 * a manual link, for now) opens the app with one of these URLs, it is handled correctly.
 */
export function useShortcutLink(onAction: (action: ShortcutAction) => void) {
  const handler = useRef(onAction); handler.current = onAction;
  useEffect(() => {
    let alive = true;
    Linking.getInitialURL()
      .then(url => { if (alive) { const action = parseShortcutUrl(url); if (action) handler.current(action); } })
      .catch(() => { /* No initial URL is the common case, not a failure worth surfacing. */ });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const action = parseShortcutUrl(url);
      if (action) handler.current(action);
    });
    return () => { alive = false; subscription.remove(); };
  }, []);
}
