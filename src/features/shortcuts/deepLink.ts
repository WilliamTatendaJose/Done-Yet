/**
 * What a `doneyet://` link asks the app to do. An object rather than a bare string because the
 * home-screen widget targets a *specific* task ("focus on this one", "open this one"), which the
 * launcher shortcuts — which have no task in hand — cannot express.
 */
export type ShortcutAction =
  | { kind: 'add-task' }
  /** taskId null means "whatever is next", which is all a launcher shortcut can know. */
  | { kind: 'focus'; taskId: string | null }
  | { kind: 'open-task'; taskId: string }
  | { kind: 'open-tasks' };

/**
 * Parses a `doneyet://` deep link into the action it names. This is what a real Android app
 * shortcut (or a Google Assistant intent built on one) would target — see useShortcutLink.ts for
 * why the shortcuts themselves are not wired up yet — and what every tappable region of the
 * home-screen widget opens (see features/widget/NextTaskWidget.tsx). Also handles a plain manual
 * open of the same URL, so the same code path is exercised by hand-testing a link without adding a
 * shortcut at all. Returns null for anything unrecognised so the caller can safely ignore it.
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
  // `doneyet://focus/<id>` puts the verb in the hostname and the id in the path; `doneyet:focus`
  // (no authority) puts the verb in the path. Treating both as one segment list covers each form.
  const segments = (parsed.hostname ? [parsed.hostname] : []).concat(parsed.pathname.split('/').filter(Boolean));
  if (segments.length === 0) return null;
  // Only the verb is case-folded: ids are compared byte-for-byte against stored task ids.
  const verb = segments[0].toLowerCase();
  const id = segments[1] ? decodeURIComponent(segments[1]) : null;
  if (verb === 'add-task' || verb === 'add_task') return { kind: 'add-task' };
  if (verb === 'focus' || verb === 'start-focus') return { kind: 'focus', taskId: id };
  if (verb === 'task') return id ? { kind: 'open-task', taskId: id } : { kind: 'open-tasks' };
  if (verb === 'tasks') return { kind: 'open-tasks' };
  return null;
}

/** The links the widget renders. Kept here, beside the parser, so a link can never drift from what
 * `parseShortcutUrl` accepts — the two are asserted against each other in deepLink.test.ts. */
export const shortcutUrls = {
  addTask: 'doneyet://add-task',
  tasks: 'doneyet://tasks',
  task: (id: string) => `doneyet://task/${encodeURIComponent(id)}`,
  focus: (id: string) => `doneyet://focus/${encodeURIComponent(id)}`,
} as const;
