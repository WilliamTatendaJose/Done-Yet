import type { AppState, Settings } from '../../../src/domain/types';
import { intervalMinutesFor, nextProjectCheckIn } from '../../../src/domain/engine';
export interface Reminder { id: string; entityId: string; kind: 'task' | 'project'; key: string; at: number; }
export interface Ledger { entries: Reminder[]; consumed: Record<string, boolean>; }
export const emptyLedger = (): Ledger => ({ entries: [], consumed: {} });
export const MAX_PENDING = 48;
/** Roughly how long the bounded queue covers at a given per-reminder interval, in minutes — the
 * consequence of picking a short interval, surfaced wherever the user picks one (editor, settings). */
export function queueCoverageMinutes(intervalMinutes: number): number { return MAX_PENDING * intervalMinutes; }
function formatMinutes(totalMinutes: number): string {
  if (totalMinutes % 1440 === 0) { const days = totalMinutes / 1440; return `${days} day${days === 1 ? '' : 's'}`; }
  if (totalMinutes % 60 === 0) { const hours = totalMinutes / 60; return `${hours} hour${hours === 1 ? '' : 's'}`; }
  if (totalMinutes < 60) return `${totalMinutes} minutes`;
  return `${Math.round((totalMinutes / 60) * 10) / 10} hours`;
}
/** Calm-voice hint for the consequence of a chosen interval, consistent with "N queued on this
 * device" in ReleaseSettings.tsx — the goal is a user cannot pick a short interval without seeing
 * the trade-off. */
export function describeQueueCoverage(intervalMinutes: number): string {
  return `About ${formatMinutes(queueCoverageMinutes(intervalMinutes))} of reminders queued on this device.`;
}
export function reminderKey(state: AppState, kind: Reminder['kind'], id: string): string | null {
  const item = kind === 'task' ? state.tasks.find(t => t.id === id && t.status === 'todo') : state.projects.find(p => p.id === id && p.progress < 100);
  if (!item) return null;
  return JSON.stringify(kind === 'task' && 'reminderMode' in item ? [kind, id, item.createdAt, item.dueAt, item.reminderMode, item.reminderLevel, item.reminderIntervalMinutes, item.snoozedUntil] : [kind, id, item.createdAt, item.dueAt, item.updatedAt]);
}
export function outsideQuietHours(at: number, settings: Settings): number | null {
  if (!settings.quietHoursEnabled) return at;
  const { quietStart: a, quietEnd: b } = settings;
  if (a === b) return null;
  const date = new Date(at); const h = date.getHours();
  const quiet = a < b ? h >= a && h < b : h >= a || h < b;
  if (!quiet) return at;
  if (a > b && h >= a) date.setDate(date.getDate() + 1);
  date.setHours(b, 0, 0, 0);
  return date.getTime();
}
/** Bounded one-shot queue: no background JS or unbounded repeating OS alarms. */
export function planReminders(state: AppState, previous: Ledger, now: number): Ledger {
  const keys = new Set([...state.tasks.map(t => reminderKey(state, 'task', t.id)), ...state.projects.map(p => reminderKey(state, 'project', p.id))].filter((k): k is string => k !== null));
  const consumed = Object.fromEntries(Object.entries(previous.consumed).filter(([key]) => keys.has(key)));
  for (const event of previous.entries) if (event.kind === 'task' && event.at <= now && keys.has(event.key)) consumed[event.key] = true;
  if (!state.settings.nativeNotificationsEnabled || state.settings.remindersPaused || state.focus?.paused) return { entries: [], consumed };
  const earliest = Math.max(now + 60000, state.focus ? Date.parse(state.focus.endsAt) : 0);
  const entries: Reminder[] = [];
  function add(entityId: string, kind: Reminder['kind'], key: string, first: number, interval?: number) {
    const pending = previous.entries.filter(e => e.key === key && e.at > now && (!state.focus || e.at >= Date.parse(state.focus.endsAt)) && outsideQuietHours(e.at, state.settings) === e.at).sort((a, b) => a.at - b.at);
    let at = pending[0]?.at ?? Math.max(first, earliest);
    // Candidate queues are merged chronologically and capped globally below.
    for (let i = 0; i < (interval ? MAX_PENDING : 1); i++) {
      const adjusted = outsideQuietHours(at, state.settings);
      if (adjusted === null || !Number.isFinite(adjusted)) return;
      at = adjusted;
      entries.push({ id: `dy_${kind}_${entityId}_${at}`, entityId, kind, key, at });
      if (!interval) return;
      at += interval;
    }
  }
  function addProject(entityId: string, key: string, first: number, dueAt: number) {
    const pending = previous.entries
      .filter(event => event.kind === 'project' && event.key === key && event.at > now && (!state.focus || event.at >= Date.parse(state.focus.endsAt)) && outsideQuietHours(event.at, state.settings) === event.at)
      .sort((a, b) => a.at - b.at);
    let at = pending[0]?.at ?? Math.max(first, earliest);
    for (let i = 0; i < MAX_PENDING; i++) {
      const adjusted = outsideQuietHours(at, state.settings);
      if (adjusted === null || !Number.isFinite(adjusted)) return;
      at = adjusted;
      entries.push({ id: `dy_project_${entityId}_${at}`, entityId, kind: 'project', key, at });
      const remaining = dueAt - at;
      const cadence = remaining > 14 * 86400000 ? 7 * 86400000 : remaining > 7 * 86400000 ? 3 * 86400000 : remaining > 2 * 86400000 ? 86400000 : 12 * 3600000;
      at += cadence;
    }
  }
  for (const task of state.tasks) {
    if (task.status !== 'todo' || !task.dueAt) continue;
    const key = reminderKey(state, 'task', task.id)!;
    if (task.reminderMode === 'normal' && (consumed[key] || (task.lastRemindedAt && !task.snoozedUntil))) continue;
    const interval = intervalMinutesFor(task) * 60000;
    const first = Math.max(Date.parse(task.dueAt), task.snoozedUntil ? Date.parse(task.snoozedUntil) : 0, task.lastRemindedAt ? Date.parse(task.lastRemindedAt) + interval : 0);
    add(task.id, 'task', key, first, task.reminderMode === 'annoy' ? interval : undefined);
  }
  for (const project of state.projects) {
    const key = reminderKey(state, 'project', project.id); const checkIn = nextProjectCheckIn(project, new Date(now));
    if (key && checkIn) addProject(project.id, key, checkIn.getTime(), Date.parse(project.dueAt));
  }
  entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  return { entries: entries.slice(0, MAX_PENDING), consumed };
}
