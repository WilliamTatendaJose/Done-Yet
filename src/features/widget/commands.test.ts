import { describe, expect, it } from 'vitest';
import { CLICK_COMPLETE, CLICK_SNOOZE, SNOOZE_MINUTES, clickCommand, commandAction, encodeCommand, parseCommand } from './commands';

describe('clickCommand: what a widget button press means', () => {
  it('maps the two known buttons onto their commands', () => {
    expect(clickCommand(CLICK_COMPLETE, { taskId: 't1' })).toEqual({ kind: 'complete', taskId: 't1' });
    expect(clickCommand(CLICK_SNOOZE, { taskId: 't1' })).toEqual({ kind: 'snooze', taskId: 't1', minutes: SNOOZE_MINUTES });
  });

  it('ignores a press carrying no task', () => {
    expect(clickCommand(CLICK_COMPLETE, undefined)).toBeNull();
    expect(clickCommand(CLICK_COMPLETE, {})).toBeNull();
    expect(clickCommand(CLICK_COMPLETE, { taskId: '' })).toBeNull();
    expect(clickCommand(CLICK_COMPLETE, { taskId: 42 })).toBeNull();
  });

  it('ignores an action this build does not know, as an older widget can still send', () => {
    expect(clickCommand('ARCHIVE_TASK', { taskId: 't1' })).toBeNull();
    expect(clickCommand(undefined, { taskId: 't1' })).toBeNull();
  });
});

describe('parseCommand: reading a queued row back', () => {
  it('round-trips every command', () => {
    for (const command of [{ kind: 'complete', taskId: 't1' }, { kind: 'snooze', taskId: 't1', minutes: 30 }] as const) {
      expect(parseCommand(encodeCommand(command))).toEqual(command);
    }
  });

  it('drops a row it cannot read rather than guessing at it', () => {
    expect(parseCommand('{')).toBeNull();
    expect(parseCommand('null')).toBeNull();
    expect(parseCommand('"complete"')).toBeNull();
    expect(parseCommand(JSON.stringify({ kind: 'archive', taskId: 't1' }))).toBeNull();
    expect(parseCommand(JSON.stringify({ kind: 'complete' }))).toBeNull();
  });

  it('falls back to the standard snooze when the stored length is unusable', () => {
    const standard = { kind: 'snooze', taskId: 't1', minutes: SNOOZE_MINUTES };
    expect(parseCommand(JSON.stringify({ kind: 'snooze', taskId: 't1', minutes: -5 }))).toEqual(standard);
    expect(parseCommand(JSON.stringify({ kind: 'snooze', taskId: 't1', minutes: 'soon' }))).toEqual(standard);
  });
});

describe('commandAction', () => {
  // completeTask rather than toggleTask: a queued press is applied late, so it must not be able to
  // reopen a task the user has since finished in the app.
  it('completes without toggling', () => {
    expect(commandAction({ kind: 'complete', taskId: 't1' })).toEqual({ type: 'completeTask', id: 't1' });
  });

  it('snoozes for the length the command carries', () => {
    expect(commandAction({ kind: 'snooze', taskId: 't1', minutes: 30 })).toEqual({ type: 'snoozeTask', id: 't1', minutes: 30 });
  });
});
