import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../../src/state/model';
import { describeQueueCoverage, emptyLedger, MAX_PENDING, outsideQuietHours, planReminders, queueCoverageMinutes } from './plan';
const now = new Date('2026-09-12T12:00:00Z').getTime();
function state() {
  const s = initialState(new Date(now)); s.settings = { ...s.settings, nativeNotificationsEnabled: true, quietHoursEnabled: false }; s.projects = [];
  s.tasks = [{ ...s.tasks[0], projectId: null, dueAt: new Date(now + 120000).toISOString(), reminderMode: 'normal' }]; return s;
}
describe('native notification planning', () => {
  it('requires opt-in and suppresses paused/completed tasks', () => {
    const s = state(); expect(planReminders(s, emptyLedger(), now).entries).toHaveLength(1);
    s.settings.nativeNotificationsEnabled = false; expect(planReminders(s, emptyLedger(), now).entries).toEqual([]);
    s.settings.nativeNotificationsEnabled = true; s.settings.remindersPaused = true; expect(planReminders(s, emptyLedger(), now).entries).toEqual([]);
    s.settings.remindersPaused = false; s.tasks[0].status = 'done'; expect(planReminders(s, emptyLedger(), now).entries).toEqual([]);
  });
  it('hands the reminder over to the occurrence a completed repeat creates', () => {
    const s = state();
    s.tasks[0] = { ...s.tasks[0], recurrence: { frequency: 'daily', interval: 1, weekdays: [], anchorAt: s.tasks[0].dueAt!, basis: 'due', until: null } };
    const before = planReminders(s, emptyLedger(), now);
    expect(before.entries).toHaveLength(1);
    const completed = reduce(s, { type: 'toggleTask', id: s.tasks[0].id }, new Date(now));
    const after = planReminders(completed, before, now);
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].entityId).not.toBe(s.tasks[0].id);
    expect(after.entries[0].at).toBeGreaterThan(before.entries[0].at);
  });
  it('does not slide an imminent pending reminder when the app refreshes', () => {
    const s = state(); const first = planReminders(s, emptyLedger(), now);
    expect(planReminders(s, first, now + 100000).entries).toEqual(first.entries);
  });
  it('does not schedule a normal reminder again after its reserved slot passes', () => {
    const s = state(); const first = planReminders(s, emptyLedger(), now);
    expect(planReminders(s, first, now + 180000).entries).toEqual([]);
  });
  it('an explicit snooze creates a fresh eligible slot', () => {
    const s = state(); const first = planReminders(s, emptyLedger(), now);
    const changed = reduce(s, { type: 'snoozeTask', id: s.tasks[0].id, minutes: 15 }, new Date(now + 180000));
    const next = planReminders(changed, first, now + 180000);
    expect(next.entries[0].at).toBe(now + 180000 + 900000);
  });
  it('cancels future slots on pause and restores them on resume', () => {
    const s = state(); const first = planReminders(s, emptyLedger(), now);
    s.settings.remindersPaused = true; const paused = planReminders(s, first, now + 1000); expect(paused.entries).toEqual([]);
    s.settings.remindersPaused = false; expect(planReminders(s, paused, now + 2000).entries).toHaveLength(1);
  });
  it('respects overnight quiet hours and treats equal start/end as all-day quiet', () => {
    const settings = { ...state().settings, quietHoursEnabled: true, quietStart: 21, quietEnd: 8 };
    const evening = new Date(2026, 8, 12, 22, 30); const morning = new Date(2026, 8, 13, 8, 0);
    expect(outsideQuietHours(evening.getTime(), settings)).toBe(morning.getTime());
    expect(outsideQuietHours(morning.getTime(), settings)).toBe(morning.getTime());
    expect(outsideQuietHours(now, { ...settings, quietEnd: 21 })).toBeNull();
  });
  it('defers schedules until active focus ends', () => {
    const s = state(); s.focus = { taskId: s.tasks[0].id, endsAt: new Date(now + 300000).toISOString(), paused: false, remainingSeconds: 300 };
    expect(planReminders(s, emptyLedger(), now).entries[0].at).toBe(now + 300000);
  });
  it('bounds the queue and preserves the selected persistence', () => {
    const s = state(); s.tasks = Array.from({ length: 20 }, (_, i) => ({ ...s.tasks[0], id: String(i), reminderMode: 'annoy', reminderLevel: 'gentle' }));
    const plan = planReminders(s, emptyLedger(), now); expect(plan.entries).toHaveLength(MAX_PENDING);
    const t = plan.entries.filter(e => e.entityId === '0'); expect(t[1].at - t[0].at).toBe(60 * 60000);
  });
  it('a per-task override takes precedence over the level interval', () => {
    const s = state();
    s.tasks[0] = { ...s.tasks[0], reminderMode: 'annoy', reminderLevel: 'gentle', reminderIntervalMinutes: 5 };
    const plan = planReminders(s, emptyLedger(), now);
    // gentle would space entries 60 minutes apart; the 5-minute override must govern instead.
    expect(plan.entries[1].at - plan.entries[0].at).toBe(5 * 60000);
  });
  it('includes project check-ins but stops them at completion', () => {
    const s = state(); s.tasks = []; s.projects = initialState(new Date(now)).projects;
    expect(planReminders(s, emptyLedger(), now).entries[0].kind).toBe('project');
    s.projects[0].progress = 100; expect(planReminders(s, emptyLedger(), now).entries).toEqual([]);
  });
  it('continues project check-ins when an earlier notification is ignored', () => {
    const s = state(); s.tasks = []; s.projects = initialState(new Date(now)).projects;
    const first = planReminders(s, emptyLedger(), now);
    const afterFirst = first.entries[0].at + 1000;
    const next = planReminders(s, first, afterFirst);
    expect(next.entries[0].kind).toBe('project');
    expect(next.entries[0].at).toBeGreaterThan(afterFirst);
    expect(next.entries[0].id).not.toBe(first.entries[0].id);
  });
});
describe('queue coverage hint (surfaces the consequence of a chosen interval)', () => {
  it('computes MAX_PENDING x interval and formats it in the calm voice used for "queued on this device"', () => {
    expect(queueCoverageMinutes(5)).toBe(MAX_PENDING * 5);
    // The rescaled table's floor (relentless=5min) covers about 4 hours — exactly the example in the brief.
    expect(describeQueueCoverage(5)).toBe('About 4 hours of reminders queued on this device.');
    expect(describeQueueCoverage(15)).toBe('About 12 hours of reminders queued on this device.');
    expect(describeQueueCoverage(30)).toBe('About 1 day of reminders queued on this device.');
    expect(describeQueueCoverage(60)).toBe('About 2 days of reminders queued on this device.');
  });
});
