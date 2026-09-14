import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  raw: null as string | null,
  pending: [] as { identifier: string; content: { data: Record<string, unknown> } }[],
  granted: true,
  channelImportance: 6,
  schedule: vi.fn(), cancel: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android', Version: 36 } }));
vi.mock('../state/database', () => ({ readMetadata: async () => mocks.raw, writeMetadata: async (_: string, value: string) => { mocks.raw = value; } }));
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(), setNotificationCategoryAsync: vi.fn(),
  setNotificationChannelAsync: async () => ({ importance: mocks.channelImportance }),
  getPermissionsAsync: async () => ({ granted: mocks.granted }),
  requestPermissionsAsync: async () => ({ granted: mocks.granted }),
  getAllScheduledNotificationsAsync: async () => mocks.pending,
  getPresentedNotificationsAsync: async () => [],
  cancelScheduledNotificationAsync: mocks.cancel,
  scheduleNotificationAsync: mocks.schedule,
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
  AndroidImportance: { NONE: 2, HIGH: 6 },
  AndroidNotificationVisibility: { PRIVATE: 2 },
  AndroidNotificationPriority: { HIGH: 'high' },
}));
import * as Notifications from 'expo-notifications';
import { ACCOUNTABILITY_CHANNEL_ID, reconcileNotifications, responseAction, sendTestNotification } from './native';
import { initialState } from '../../../src/state/model';
import { reminderKey } from './plan';
function state() { const s = initialState(); s.settings = { ...s.settings, nativeNotificationsEnabled: true, quietHoursEnabled: false }; s.projects = []; s.tasks = [{ ...s.tasks[0], projectId: null, reminderMode: 'normal', dueAt: new Date(Date.now() + 300000).toISOString() }]; return s; }
beforeEach(() => { mocks.raw = null; mocks.pending = []; mocks.granted = true; mocks.channelImportance = 6; mocks.cancel.mockReset(); mocks.schedule.mockReset().mockImplementation(async (request: { identifier: string; content: { data: Record<string, unknown> } }) => { mocks.pending.push(request); return request.identifier; }); });
describe('OS notification reconciliation', () => {
  it('does not duplicate an already scheduled request', async () => {
    const s = state(); await reconcileNotifications(s); await reconcileNotifications(s);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });
  it('cancels only owned requests when reminders are disabled', async () => {
    const s = state(); await reconcileNotifications(s);
    mocks.pending.push({ identifier: 'unrelated', content: { data: {} } });
    s.settings.remindersPaused = true; await reconcileNotifications(s);
    expect(mocks.cancel).toHaveBeenCalledTimes(1); expect(mocks.cancel.mock.calls[0][0]).toMatch(/^dy_/);
  });
  it('does not schedule when permission is denied', async () => {
    mocks.granted = false; const result = await reconcileNotifications(state());
    expect(result.granted).toBe(false); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('does not schedule when the Android notification channel is blocked', async () => {
    mocks.channelImportance = 2;
    const result = await reconcileNotifications(state());
    expect(result.granted).toBe(false); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('uses the visible high-priority channel and sound for task reminders', async () => {
    await reconcileNotifications(state());
    const scheduled = mocks.schedule.mock.calls[0][0];
    expect(scheduled.trigger.channelId).toBe(ACCOUNTABILITY_CHANNEL_ID);
    expect(scheduled.content.sound).toBe('default');
  });
  it('schedules a short diagnostic reminder outside the planner', async () => {
    expect(await sendTestNotification()).toBe(true);
    const scheduled = mocks.schedule.mock.calls[0][0];
    expect(scheduled.identifier).toMatch(/^notification_test_/);
    expect(scheduled.trigger).toMatchObject({ type: 'timeInterval', seconds: 2, channelId: ACCOUNTABILITY_CHANNEL_ID });
  });
  it('does not record failed schedules as delivered and retries later', async () => {
    mocks.schedule.mockRejectedValueOnce(Error('OS unavailable'));
    const s = state(); await expect(reconcileNotifications(s)).rejects.toThrow();
    expect(JSON.parse(mocks.raw!).entries).toEqual([]);
    await reconcileNotifications(s); expect(JSON.parse(mocks.raw!).entries).toHaveLength(1);
  });
  it('recovers a successfully scheduled request if metadata was not written before interruption', async () => {
    const s = state(); await reconcileNotifications(s); mocks.raw = null;
    await reconcileNotifications(s); expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });
  it('ignores stale actions and uses idempotent completion', () => {
    const s = state(); const data = { owner: 'done-yet', kind: 'task', entityId: s.tasks[0].id, key: reminderKey(s, 'task', s.tasks[0].id) };
    expect(responseAction(s, data, 'DONE')?.type).toBe('completeTask');
    s.tasks[0].status = 'done'; expect(responseAction(s, data, 'DONE')).toBeNull();
    expect(responseAction(s, {}, 'DONE')).toBeNull();
  });
  it('registers "I\'m working on it" and "I\'m blocked" alongside the existing task actions, and a text-input action for project check-ins', async () => {
    await reconcileNotifications(state());
    const calls = vi.mocked(Notifications.setNotificationCategoryAsync).mock.calls;
    const task = calls.find(c => c[0] === 'DONEYET')![1];
    expect(task.map(a => a.identifier)).toEqual(['DONE', 'SNOOZE', 'WORKING', 'BLOCKED']);
    const project = calls.find(c => c[0] === 'DONEYET_PROJECT')![1];
    expect(project[0].identifier).toBe('UPDATE_PROGRESS');
    expect(project[0].textInput).toBeTruthy();
  });
  it('"I\'m working on it" engages rather than completes, and "I\'m blocked" records a blocker', () => {
    const s = state(); const data = { owner: 'done-yet', kind: 'task', entityId: s.tasks[0].id, key: reminderKey(s, 'task', s.tasks[0].id) };
    expect(responseAction(s, data, 'WORKING')).toEqual({ type: 'engageTask', id: s.tasks[0].id });
    expect(responseAction(s, data, 'BLOCKED')).toEqual({ type: 'recordEngagement', id: s.tasks[0].id, kind: 'blocked' });
  });
  it('parses a project check-in text reply into a progress update, and degrades gracefully when no number is present', () => {
    const s = state(); s.projects = [{ id: 'p', title: 'p', description: '', createdAt: s.tasks[0].createdAt, dueAt: new Date(Date.now() + 86400000).toISOString(), progress: 10, updatedAt: s.tasks[0].createdAt, lastCheckInAt: null }];
    const data = { owner: 'done-yet', kind: 'project', entityId: 'p', key: reminderKey(s, 'project', 'p') };
    expect(responseAction(s, data, 'UPDATE_PROGRESS', '60')).toEqual({ type: 'progress', id: 'p', progress: 60 });
    expect(responseAction(s, data, 'UPDATE_PROGRESS', '150')).toEqual({ type: 'progress', id: 'p', progress: 100 });
    // No usable number (unsupported platform, or an empty/cancelled reply): no action, so the caller
    // falls back to just opening the app, exactly like tapping a notification with no actions at all.
    expect(responseAction(s, data, 'UPDATE_PROGRESS', undefined)).toBeNull();
    expect(responseAction(s, data, 'UPDATE_PROGRESS', 'not a number')).toBeNull();
  });
  it('gives task reminders dynamic, personality-aware wording under the task category', async () => {
    const s = state(); s.settings.personality = 'direct';
    await reconcileNotifications(s);
    const scheduled = mocks.schedule.mock.calls[0][0];
    expect(scheduled.content.categoryIdentifier).toBe('DONEYET');
    expect(scheduled.content.body).toContain(s.tasks[0].title);
  });
  it('schedules project check-ins under the project text-input category', async () => {
    const s = state(); s.tasks = [];
    s.projects = [{ id: 'p', title: 'p', description: '', createdAt: new Date(Date.now() - 86400000).toISOString(), dueAt: new Date(Date.now() + 86400000).toISOString(), progress: 10, updatedAt: '', lastCheckInAt: null }];
    await reconcileNotifications(s);
    expect(mocks.schedule.mock.calls.length).toBeGreaterThan(0);
    for (const call of mocks.schedule.mock.calls) expect(call[0].content.categoryIdentifier).toBe('DONEYET_PROJECT');
  });
});
