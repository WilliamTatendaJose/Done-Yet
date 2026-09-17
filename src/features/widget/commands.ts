import type { Action } from '../../../../src/state/model';

/** Matches the notification action of the same name (notifications/native.ts), so "Snooze" means
 * the same thing wherever the user meets it. */
export const SNOOZE_MINUTES = 15;

/** `clickAction` strings the widget's buttons carry. Anything other than `OPEN_APP`/`OPEN_URI`
 * reaches the headless task instead of being handled natively, which is what makes these work with
 * no app running. */
export const CLICK_COMPLETE = 'COMPLETE_TASK';
export const CLICK_SNOOZE = 'SNOOZE_TASK';

/**
 * The only things a home-screen tap may ask for. Deliberately tiny: a queued command is applied
 * later, against a snapshot that may have moved on, so each one has to still make sense out of
 * order and out of time. Both of these do — see `commandAction`.
 */
export type WidgetCommand =
  | { kind: 'complete'; taskId: string }
  | { kind: 'snooze'; taskId: string; minutes: number };

/** The command a widget button press asks for, or null for a press this build does not know — an
 * older widget still sitting on the home screen after an app update can send exactly that. */
export function clickCommand(clickAction: string | undefined, data: Record<string, unknown> | undefined): WidgetCommand | null {
  const taskId = typeof data?.taskId === 'string' && data.taskId ? data.taskId : null;
  if (!taskId) return null;
  if (clickAction === CLICK_COMPLETE) return { kind: 'complete', taskId };
  if (clickAction === CLICK_SNOOZE) return { kind: 'snooze', taskId, minutes: SNOOZE_MINUTES };
  return null;
}

export function encodeCommand(command: WidgetCommand): string {
  return JSON.stringify(command);
}

/** Reads a row back. Rows outlive app updates, so this validates rather than trusts: anything
 * unrecognised is dropped by the drain instead of being applied as a half-understood action. */
export function parseCommand(payload: string): WidgetCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { kind, taskId, minutes } = value as Record<string, unknown>;
  if (typeof taskId !== 'string' || !taskId) return null;
  if (kind === 'complete') return { kind: 'complete', taskId };
  if (kind === 'snooze') return { kind: 'snooze', taskId, minutes: Number.isInteger(minutes) && (minutes as number) > 0 ? minutes as number : SNOOZE_MINUTES };
  return null;
}

/**
 * The reducer action a command becomes. Both map to actions that are safe to apply late:
 * `completeTask` only ever completes (unlike `toggleTask`, it cannot resurrect a task the user has
 * since finished in the app, and applying it twice is a no-op), and `snoozeTask` is already a
 * no-op on a task that is done.
 */
export function commandAction(command: WidgetCommand): Action {
  return command.kind === 'complete'
    ? { type: 'completeTask', id: command.taskId }
    : { type: 'snoozeTask', id: command.taskId, minutes: command.minutes };
}
