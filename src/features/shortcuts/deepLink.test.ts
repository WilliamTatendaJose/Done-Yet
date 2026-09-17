import { describe, expect, it } from 'vitest';
import { parseShortcutUrl, shortcutUrls } from './deepLink';

describe('parseShortcutUrl: rejection', () => {
  it('ignores nothing at all', () => {
    expect(parseShortcutUrl(null)).toBeNull();
    expect(parseShortcutUrl(undefined)).toBeNull();
    expect(parseShortcutUrl('')).toBeNull();
  });

  it('ignores a malformed url rather than throwing', () => {
    expect(parseShortcutUrl('not a url')).toBeNull();
  });

  it('ignores another app\u2019s scheme even when the verb matches', () => {
    expect(parseShortcutUrl('https://add-task')).toBeNull();
    expect(parseShortcutUrl('otherapp://focus')).toBeNull();
  });

  it('ignores an unknown verb', () => {
    expect(parseShortcutUrl('doneyet://settings')).toBeNull();
    expect(parseShortcutUrl('doneyet://')).toBeNull();
  });
});

describe('parseShortcutUrl: launcher shortcuts', () => {
  it('parses both spellings of the add-task link', () => {
    expect(parseShortcutUrl('doneyet://add-task')).toEqual({ kind: 'add-task' });
    expect(parseShortcutUrl('doneyet://add_task')).toEqual({ kind: 'add-task' });
  });

  it('parses a focus link with no task as "whatever is next"', () => {
    expect(parseShortcutUrl('doneyet://focus')).toEqual({ kind: 'focus', taskId: null });
    expect(parseShortcutUrl('doneyet://start-focus')).toEqual({ kind: 'focus', taskId: null });
  });

  it('accepts the authority-less form a hand-typed link can take', () => {
    expect(parseShortcutUrl('doneyet:add-task')).toEqual({ kind: 'add-task' });
    expect(parseShortcutUrl('doneyet:focus')).toEqual({ kind: 'focus', taskId: null });
  });

  it('case-folds the verb', () => {
    expect(parseShortcutUrl('doneyet://Add-Task')).toEqual({ kind: 'add-task' });
  });
});

describe('parseShortcutUrl: widget links naming one task', () => {
  it('parses a focus link that names its task', () => {
    expect(parseShortcutUrl('doneyet://focus/task-42')).toEqual({ kind: 'focus', taskId: 'task-42' });
  });

  it('parses an open-task link', () => {
    expect(parseShortcutUrl('doneyet://task/task-42')).toEqual({ kind: 'open-task', taskId: 'task-42' });
  });

  it('falls back to the list for a task link with no id', () => {
    expect(parseShortcutUrl('doneyet://task')).toEqual({ kind: 'open-tasks' });
    expect(parseShortcutUrl('doneyet://tasks')).toEqual({ kind: 'open-tasks' });
  });

  it('preserves the case of an id while still folding the verb', () => {
    expect(parseShortcutUrl('doneyet://Task/AbC-9')).toEqual({ kind: 'open-task', taskId: 'AbC-9' });
  });

  it('decodes an escaped id', () => {
    expect(parseShortcutUrl('doneyet://task/a%2Fb')).toEqual({ kind: 'open-task', taskId: 'a/b' });
  });
});

describe('shortcutUrls', () => {
  // The widget renders these strings and the app parses them; nothing type-checks that pairing, so
  // assert it here — a drift between the two is a dead tap target on someone's home screen.
  it('round-trips every link the widget renders', () => {
    expect(parseShortcutUrl(shortcutUrls.addTask)).toEqual({ kind: 'add-task' });
    expect(parseShortcutUrl(shortcutUrls.tasks)).toEqual({ kind: 'open-tasks' });
    expect(parseShortcutUrl(shortcutUrls.task('abc-123'))).toEqual({ kind: 'open-task', taskId: 'abc-123' });
    expect(parseShortcutUrl(shortcutUrls.focus('abc-123'))).toEqual({ kind: 'focus', taskId: 'abc-123' });
  });

  it('round-trips an id that needs escaping', () => {
    const id = 'a/b c';
    expect(parseShortcutUrl(shortcutUrls.task(id))).toEqual({ kind: 'open-task', taskId: id });
    expect(parseShortcutUrl(shortcutUrls.focus(id))).toEqual({ kind: 'focus', taskId: id });
  });
});
