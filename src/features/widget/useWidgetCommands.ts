import { useEffect, useRef, useState } from 'react';
import { AppState as DeviceAppState } from 'react-native';
import type { Action } from '../../../../src/state/model';
import { commandQueue } from '../../state/commandQueue';
import { commandAction, parseCommand } from './commands';

/**
 * Drains the widget's button presses into the app: on launch, and on every return to the
 * foreground — which is exactly when a press made on the home screen becomes visible to the running
 * app. Applying them here rather than in the headless task that received them is the whole point of
 * the queue (see state/commandQueue.ts): the reducer runs in one place, so reminder reconciliation,
 * calendar mirroring and the widget's own refresh all follow from the resulting state change for
 * free.
 *
 * Nothing is cleared until the write is acknowledged, and only up to the last row that was read, so
 * a press that lands mid-drain survives to the next one. A press that lands *during* a drain does
 * not re-trigger this — it is picked up on the next foreground, at worst one activation later.
 */
export function useWidgetCommands(ready: boolean, applyQueued: (commands: ReadonlyArray<{ action: Action; at: Date }>) => Promise<boolean>) {
  const apply = useRef(applyQueued); apply.current = applyQueued;
  const draining = useRef(false);
  const [foregrounded, setForegrounded] = useState(0);
  useEffect(() => {
    const listener = DeviceAppState.addEventListener('change', value => { if (value === 'active') setForegrounded(count => count + 1); });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!ready || draining.current) return;
    draining.current = true;
    void (async () => {
      try {
        const rows = await commandQueue.read();
        if (rows.length === 0) return;
        const through = rows[rows.length - 1].id;
        const commands = rows.flatMap(row => {
          const command = parseCommand(row.payload);
          const at = new Date(row.at);
          // A row this build cannot read, or one with an unusable timestamp, is dropped rather than
          // applied as a guess — and dropped for good, since `through` clears it either way. Left in
          // place it would block every command behind it forever.
          return command && Number.isFinite(at.getTime()) ? [{ action: commandAction(command), at }] : [];
        });
        if (commands.length > 0 && !await apply.current(commands)) return;
        await commandQueue.clearThrough(through);
      } catch {
        // Storage is unavailable or the write failed: the queue is intact, so try again next time
        // the app comes forward. A widget press is never lost by a failure here, only delayed.
      } finally {
        draining.current = false;
      }
    })();
  }, [ready, foregrounded]);
}
