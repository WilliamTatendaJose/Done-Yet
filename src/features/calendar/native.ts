import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import type { Task } from '../../../../src/domain/types';
import { busyOverlap, BUSY_WINDOW_MINUTES, type BusyCheck } from '../../../../src/domain/busy';
import { readMetadata, writeMetadata } from '../../state/database';

// expo-calendar's default export in SDK 57 is the class-based "Next" API (ExpoCalendar /
// ExpoCalendarEvent, with instance .update()/.delete() and static .get()) — the older *Async
// free-function API only exists any more under the `expo-calendar/legacy` subpath. Confirmed by
// reading the installed package's build/Calendar.d.ts rather than assuming the pre-57 shape.
const CALENDAR_TITLE = 'Done Yet?';
const CALENDAR_ID_KEY = 'calendar_id_v1';

/** Mirrors the notifications module's pattern: ask if already granted, request only if not. */
export async function requestCalendarPermission(): Promise<boolean> {
  const current = await Calendar.getCalendarPermissions();
  return current.granted || (await Calendar.requestCalendarPermissions()).granted;
}

async function hasCalendarPermission(): Promise<boolean> {
  return (await Calendar.getCalendarPermissions()).granted;
}

/** Android has no single system default calendar (unlike iOS), so a local-account source is what
 * every guide for this module uses to create one that is not tied to a synced account and so
 * cannot be silently removed if that account is removed. */
function newCalendarSource(): Calendar.Source {
  if (Platform.OS === 'ios') {
    try { return Calendar.getDefaultCalendarSync().source; } catch { /* fall through to the Android-style source below */ }
  }
  return { isLocalAccount: true, name: CALENDAR_TITLE, type: Calendar.SourceType.LOCAL };
}

/**
 * Finds (or creates) the app's own "Done Yet?" calendar. Never touches any other calendar on the
 * device. Caches the id in device-local metadata (the same table the notification ledger uses) as
 * a lookup shortcut, but always re-verifies the id still refers to a real calendar before trusting
 * it, since the user can delete calendars from the OS Calendar app.
 */
export async function ensureDoneYetCalendar(): Promise<Calendar.ExpoCalendar> {
  if (!(await hasCalendarPermission())) throw new Error('Calendar access is off. Turn on calendar sync in Settings to let Done Yet? add its own calendar.');
  let calendars: Calendar.ExpoCalendar[];
  try {
    calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  } catch {
    throw new Error('Could not read your calendars.');
  }
  const cached = await readMetadata(CALENDAR_ID_KEY);
  const stillThere = cached ? calendars.find(c => c.id === cached) : undefined;
  if (stillThere) return stillThere;
  const existing = calendars.find(c => c.title === CALENDAR_TITLE && c.allowsModifications);
  if (existing) {
    await writeMetadata(CALENDAR_ID_KEY, existing.id);
    return existing;
  }
  try {
    const calendar = await Calendar.createCalendar({
      title: CALENDAR_TITLE,
      color: '#D4F887',
      entityType: Calendar.EntityTypes.EVENT,
      source: newCalendarSource(),
      name: 'doneyet',
      ownerAccount: CALENDAR_TITLE,
      accessLevel: Calendar.CalendarAccessLevel.OWNER,
    });
    await writeMetadata(CALENDAR_ID_KEY, calendar.id);
    return calendar;
  } catch {
    throw new Error('Could not create the "Done Yet?" calendar.');
  }
}

const eventDetails = (task: Task): Partial<Calendar.ExpoCalendarEvent> => ({
  title: task.title,
  startDate: new Date(task.dueAt as string),
  endDate: new Date(new Date(task.dueAt as string).getTime() + 30 * 60_000),
  notes: 'Added by Done Yet?. Editing the task in the app updates this event.',
});

/**
 * Creates or updates the mirrored event for one task so it matches the task's current title and
 * deadline. Callers decide *whether* a task should have an event (see useCalendarSync); this only
 * handles making one exist and be in step, given that `task.dueAt` is set. Self-healing: if
 * `task.calendarEventId` points at an event the user deleted from the OS calendar app, the lookup
 * fails and this falls back to creating a fresh one rather than throwing.
 */
export async function upsertTaskEvent(task: Task): Promise<string> {
  if (task.dueAt === null) throw new Error('Cannot mirror a task with no deadline.');
  const calendar = await ensureDoneYetCalendar();
  if (task.calendarEventId) {
    try {
      const event = await Calendar.ExpoCalendarEvent.get(task.calendarEventId);
      await event.update(eventDetails(task));
      return task.calendarEventId;
    } catch {
      // Deleted out from under us (or otherwise inaccessible) — fall through to create a replacement.
    }
  }
  try {
    const event = await calendar.createEvent(eventDetails(task));
    return event.id;
  } catch {
    throw new Error(`Could not add "${task.title}" to your calendar.`);
  }
}

/** Best-effort delete: tolerates an event that is already gone (deleted by the user, or the
 * calendar itself removed) so cleanup never blocks whatever caller triggered it. */
export async function deleteTaskEvent(eventId: string): Promise<void> {
  try {
    const event = await Calendar.ExpoCalendarEvent.get(eventId);
    await event.delete();
  } catch {
    // Already gone, or calendar access changed — nothing more we can safely do here.
  }
}

/**
 * Reads only the `[deadline - BUSY_WINDOW_MINUTES, deadline + BUSY_WINDOW_MINUTES]` slice of the
 * device calendars — never the whole calendar — and reduces it to a count and busy/free via the
 * pure `busyOverlap`. Event titles never leave this function: only start/end times are extracted.
 */
export async function checkDeadlineBusy(dueAt: string, now: Date): Promise<BusyCheck> {
  if (!(await hasCalendarPermission())) throw new Error('Calendar access is off. Turn on the busy check in Settings to see conflicts.');
  const target = Date.parse(dueAt);
  if (!Number.isFinite(target)) return { busy: false, count: 0 };
  const start = new Date(target - BUSY_WINDOW_MINUTES * 60_000);
  const end = new Date(target + BUSY_WINDOW_MINUTES * 60_000);
  let calendars: Calendar.ExpoCalendar[];
  try {
    calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  } catch {
    throw new Error('Could not read your calendars.');
  }
  if (!calendars.length) return { busy: false, count: 0 };
  let events: Calendar.ExpoCalendarEvent[];
  try {
    events = await Calendar.listEvents(calendars, start, end);
  } catch {
    throw new Error('Could not check your calendar for conflicts.');
  }
  const plain = events.map(e => ({
    start: new Date(e.startDate).toISOString(),
    end: new Date(e.endDate).toISOString(),
  }));
  return busyOverlap(dueAt, plain, now);
}
