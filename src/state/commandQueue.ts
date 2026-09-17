import { database } from './database';

export interface QueuedCommand { id: number; payload: string; at: string }

/** A queue this long means the app has not been opened in a very long time while the home screen
 * kept being tapped. Dropping the oldest rows past it bounds the table; the snapshot itself is
 * never at risk, since the app is still the only thing that writes it. */
const MAX_QUEUED = 100;

/**
 * A durable FIFO of commands raised outside the running app — today, taps on the home-screen
 * widget's Done/Snooze buttons, which Android delivers to a headless JS task with no app and no
 * loaded state behind it (see features/widget/widgetTaskHandler.ts).
 *
 * Why a queue rather than writing the snapshot from that task: state/controller.ts holds the
 * snapshot in memory and every command rewrites the whole thing, so a second writer would be
 * silently clobbered by the running app's next save. Enqueuing keeps the reducer — and the single
 * writer — inside the app, where reminder reconciliation and calendar mirroring already run off
 * the resulting state change. The app drains this on launch and on every return to the foreground
 * (features/widget/useWidgetCommands.ts).
 *
 * The payload is opaque here on purpose: the vocabulary of what may be queued belongs to the
 * feature raising it (features/widget/commands.ts), not to storage.
 */
export const commandQueue = {
  async enqueue(payload: string, at: string): Promise<void> {
    const db = await database();
    await db.runAsync('INSERT INTO pending_commands (payload,at) VALUES (?,?)', payload, at);
    await db.runAsync('DELETE FROM pending_commands WHERE id <= (SELECT MAX(id) FROM pending_commands) - ?', MAX_QUEUED);
  },
  async read(): Promise<QueuedCommand[]> {
    return (await database()).getAllAsync<QueuedCommand>('SELECT id,payload,at FROM pending_commands ORDER BY id');
  },
  /** Drops everything up to and including `id`. Bounded that way rather than emptying the table, so
   * a command enqueued by a tap *during* a drain is not thrown away unapplied. */
  async clearThrough(id: number): Promise<void> {
    await (await database()).runAsync('DELETE FROM pending_commands WHERE id <= ?', id);
  },
};
