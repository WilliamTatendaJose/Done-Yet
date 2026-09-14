import { useEffect, useRef, useState } from 'react';
import type { AppState } from '../../../../src/domain/types';
import type { Action } from '../../../../src/state/model';
import { deleteTaskEvent, upsertTaskEvent } from './native';

/** Serializes reconciliation runs the same way notifications/native.ts serializes its own
 * scheduling chain, so an overlapping state change never interleaves calendar writes. */
let chain: Promise<unknown> = Promise.resolve();

/**
 * Keeps the "Done Yet?" calendar in step with `state` whenever it changes: a todo task with a
 * deadline gets a mirrored event (created once, then updated in place as the deadline or title
 * changes); a task that is done, has no deadline, or was deleted has its mirrored event removed.
 * Runs only while `settings.calendarWriteEnabled` is on; turning it off sweeps up anything already
 * mirrored so no orphaned events are left behind in the user's calendar app.
 *
 * A single task failing (permission revoked mid-session, the OS calendar briefly unavailable) never
 * blocks the rest — each task is reconciled independently, matching how reconcileNotifications
 * treats one failed schedule versus the whole batch.
 */
export function useCalendarSync(state: AppState | null, dispatch: (action: Action) => Promise<boolean>) {
  const [error, setError] = useState('');
  const dispatchRef = useRef(dispatch); dispatchRef.current = dispatch;
  useEffect(() => {
    if (!state) return;
    let alive = true;
    const enabled = !!state.settings.calendarWriteEnabled;
    const tasks = state.tasks;
    const operation = chain.catch(() => undefined).then(async () => {
      let anyFailed = false;
      for (const task of tasks) {
        const desired = enabled && task.status === 'todo' && task.dueAt !== null;
        try {
          if (!desired) {
            if (task.calendarEventId) {
              await deleteTaskEvent(task.calendarEventId);
              await dispatchRef.current({ type: 'setCalendarEventId', id: task.id, calendarEventId: null });
            }
            continue;
          }
          const eventId = await upsertTaskEvent(task);
          if (eventId !== task.calendarEventId) await dispatchRef.current({ type: 'setCalendarEventId', id: task.id, calendarEventId: eventId });
        } catch {
          anyFailed = true;
        }
      }
      if (alive) setError(anyFailed ? 'Some deadlines could not be synced to your calendar. In-app reminders are unaffected.' : '');
    });
    chain = operation;
    return () => { alive = false; };
  }, [state]);
  return { error };
}
