import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { AppState } from '../../../src/domain/types';
import type { Action } from '../../../src/state/model';
import { reminderContent } from '../../../src/domain/wording';
import { readMetadata, writeMetadata } from '../state/database';
import { emptyLedger, planReminders, reminderKey, type Ledger } from './plan';

const LEDGER_KEY = 'notification_ledger_v1';
const SCHEDULE_BATCH_SIZE = 8;
export const ACCOUNTABILITY_CHANNEL_ID = 'accountability-v2';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    priority: Notifications.AndroidNotificationPriority.HIGH,
  }),
});

async function ensureNotificationChannel(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const channel = await Notifications.setNotificationChannelAsync(ACCOUNTABILITY_CHANNEL_ID, {
    name: 'Accountability reminders',
    description: 'Task deadlines, follow-ups, and project check-ins',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    sound: 'default',
    enableVibrate: true,
    vibrationPattern: [0, 250, 150, 250],
  });
  // Channel APIs are a no-op below Android 8. On newer Android versions a channel whose
  // importance is NONE was explicitly disabled by the user and must not suppress our in-app fallback.
  return channel === null || channel.importance !== Notifications.AndroidImportance.NONE;
}

async function notificationDeliveryAvailable(): Promise<boolean> {
  const channelAvailable = await ensureNotificationChannel();
  return channelAvailable && (await Notifications.getPermissionsAsync()).granted;
}

export async function requestNotificationPermission() {
  await ensureNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  return granted && await ensureNotificationChannel();
}

/** Schedules a prompt that bypasses the app's reminder planner and quiet hours. */
export async function sendTestNotification(): Promise<boolean> {
  if (!(await notificationDeliveryAvailable())) return false;
  await Notifications.scheduleNotificationAsync({
    identifier: `notification_test_${Date.now()}`,
    content: {
      title: 'Done Yet? notifications work',
      body: 'This test reminder came from your device.',
      sound: 'default',
      data: { owner: 'done-yet-test' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
      channelId: ACCOUNTABILITY_CHANNEL_ID,
    },
  });
  return true;
}
let chain: Promise<unknown> = Promise.resolve();
export function reconcileNotifications(state: AppState) {
  const operation = chain.catch(() => undefined).then(async () => {
    const raw = await readMetadata(LEDGER_KEY);
    let previous = emptyLedger();
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === 'object' && Array.isArray((value as Ledger).entries) && (value as Ledger).consumed && typeof (value as Ledger).consumed === 'object') previous = value as Ledger;
      } catch { /* Reconcile from OS state below when metadata is damaged. */ }
    }
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    // Recover requests scheduled just before a process interruption.
    for (const request of pending) {
      const d = request.content.data ?? {};
      if (d.owner === 'done-yet' && typeof d.at === 'number' && typeof d.entityId === 'string' && (d.kind === 'task' || d.kind === 'project') && typeof d.key === 'string' && !previous.entries.some(e => e.id === request.identifier)) previous.entries.push({ id: request.identifier, entityId: d.entityId, kind: d.kind, key: d.key, at: d.at });
    }
    const granted = await notificationDeliveryAvailable();
    const effective = granted ? state : { ...state, settings: { ...state.settings, nativeNotificationsEnabled: false } };
    const next = planReminders(effective, previous, Date.now());
    const wanted = new Set(next.entries.map(e => e.id));
    for (const request of pending) if (request.identifier.startsWith('dy_') && !wanted.has(request.identifier)) await Notifications.cancelScheduledNotificationAsync(request.identifier);
    const exists = new Set(pending.map(p => p.identifier));
    // Every action here dispatches through the reducer and must persist before the response is
    // acknowledged, so all of them bring the app forward rather than trying to run a background task.
    await Notifications.setNotificationCategoryAsync('DONEYET', [
      { identifier: 'DONE', buttonTitle: 'Done', options: { opensAppToForeground: true } },
      { identifier: 'SNOOZE', buttonTitle: 'Snooze 15m', options: { opensAppToForeground: true } },
      { identifier: 'WORKING', buttonTitle: "I'm working on it", options: { opensAppToForeground: true } },
      { identifier: 'BLOCKED', buttonTitle: "I'm blocked", options: { opensAppToForeground: true } },
    ]);
    // Text input actions are cross-platform in expo-notifications (Android via RemoteInput, iOS via
    // UNTextInputNotificationAction); only `submitButtonTitle` is iOS-only, so Android shows its own
    // default send label. Where a device predates category support (Android below 8.0), the OS treats
    // the whole category as a no-op and a tap just opens the app — the same graceful fallback already
    // used for a plain task tap, handled by `openProject` regardless of whether progress was parsed.
    await Notifications.setNotificationCategoryAsync('DONEYET_PROJECT', [
      { identifier: 'UPDATE_PROGRESS', buttonTitle: 'Update progress', options: { opensAppToForeground: true }, textInput: { placeholder: 'Progress % (e.g. 60)', submitButtonTitle: 'Save' } },
    ]);
    const confirmed: Ledger = { consumed: next.consumed, entries: next.entries.filter(reminder => exists.has(reminder.id)) };
    let schedulingError: unknown;
    let schedulingFailed = false;
    try {
      // The native module can accept several requests at once. Small batches
      // reduce bridge latency without flooding the OS scheduler, while the
      // ledger still records only requests that actually succeeded.
      const missing = next.entries.filter(reminder => !exists.has(reminder.id));
      for (let offset = 0; offset < missing.length; offset += SCHEDULE_BATCH_SIZE) {
        const batch = missing.slice(offset, offset + SCHEDULE_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(async reminder => {
          const task = reminder.kind === 'task' ? state.tasks.find(t => t.id === reminder.entityId) : undefined;
          // Dynamic wording: title/body reflect the task's own level, the chosen personality and what
          // the user has actually done with past reminders, so repeats don't all read identically.
          const content = task ? reminderContent(task, task.reminderLevel, state.settings.personality) : { title: 'Done Yet?', body: reminder.kind === 'task' ? 'One small step is waiting. Open to continue.' : 'Time for a project progress check-in.' };
          await Notifications.scheduleNotificationAsync({
            identifier: reminder.id,
            content: { title: content.title, body: reminder.kind === 'task' ? content.body : 'Time for a project progress check-in.', sound: 'default', categoryIdentifier: reminder.kind === 'task' ? 'DONEYET' : 'DONEYET_PROJECT', data: { owner: 'done-yet', ...reminder } },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.at), channelId: ACCOUNTABILITY_CHANNEL_ID },
          });
          return reminder;
        }));
        results.forEach(result => {
          if (result.status === 'fulfilled') confirmed.entries.push(result.value);
          else { schedulingFailed = true; if (schedulingError === undefined) schedulingError = result.reason; }
        });
        if (schedulingFailed) break;
      }
      if (schedulingFailed) throw schedulingError ?? new Error('Notification scheduling failed.');
    } finally {
      confirmed.entries.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      await writeMetadata(LEDGER_KEY, JSON.stringify(confirmed));
    }
    // Remove stale delivered prompts for completed/deleted/changed entities.
    for (const shown of await Notifications.getPresentedNotificationsAsync()) {
      const data = shown.request.content.data ?? {};
      if (data.owner === 'done-yet' && reminderKey(state, data.kind as 'task' | 'project', String(data.entityId)) !== data.key) await Notifications.dismissNotificationAsync(shown.request.identifier);
    }
    return { count: next.entries.length, granted };
  });
  chain = operation;
  return operation;
}
/** Reads a leading integer out of a text-input reply and clamps it to a valid progress percentage. */
function parseProgress(text: string | undefined): number | null {
  if (!text) return null;
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}
export function responseAction(state: AppState, data: Record<string, unknown>, identifier: string, userText?: string): Action | null {
  if (data.owner !== 'done-yet' || typeof data.entityId !== 'string' || typeof data.key !== 'string') return null;
  if (data.kind === 'task') {
    if (reminderKey(state, 'task', data.entityId) !== data.key) return null;
    if (identifier === 'DONE') return { type: 'completeTask', id: data.entityId };
    if (identifier === 'SNOOZE') return { type: 'snoozeTask', id: data.entityId, minutes: 15 };
    // "I'm working on it": engagement, not completion — see model.ts `engageTask`.
    if (identifier === 'WORKING') return { type: 'engageTask', id: data.entityId };
    // "I'm blocked": records the blocker; the caller (useNotifications) routes to the Coach tab.
    if (identifier === 'BLOCKED') return { type: 'recordEngagement', id: data.entityId, kind: 'blocked' };
    return null;
  }
  if (data.kind === 'project') {
    if (reminderKey(state, 'project', data.entityId) !== data.key) return null;
    if (identifier === 'UPDATE_PROGRESS') {
      // No parseable number (platform without text-input support, or an empty/cancelled reply)
      // degrades gracefully: no action is dispatched, and the caller still opens the app to Projects.
      const progress = parseProgress(userText);
      return progress === null ? null : { type: 'progress', id: data.entityId, progress };
    }
    return null;
  }
  return null;
}
