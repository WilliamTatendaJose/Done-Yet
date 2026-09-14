export type ShortcutAction = 'add-task' | 'focus';

/**
 * Parses a `doneyet://` deep link into the action it names. This is what a real Android app
 * shortcut (or a Google Assistant intent built on one) would target — see useShortcutLink.ts for
 * why the shortcuts themselves are not wired up yet. Also handles a plain manual open of the same
 * URL, so the same code path is exercised by hand-testing a link without adding a shortcut at all.
 * Returns null for anything unrecognised so the caller can safely ignore it.
 */
export function parseShortcutUrl(url: string | null | undefined): ShortcutAction | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'doneyet:') return null;
  const action = (parsed.hostname || parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  if (action === 'add-task' || action === 'add_task') return 'add-task';
  if (action === 'focus' || action === 'start-focus') return 'focus';
  return null;
}
