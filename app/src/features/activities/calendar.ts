import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import type { ActivityPage, SessionInfo } from './types';

export type CalendarResult = 'added' | 'cancelled' | 'unavailable';

/** Opens the phone's own "new event" screen, prefilled; nothing is written without the user saving. */
export async function addSessionToCalendar(
  session: Pick<SessionInfo, 'startsAt' | 'placeLabel'>,
  activity: Pick<ActivityPage, 'title' | 'durationMinutes' | 'timezone'>,
): Promise<CalendarResult> {
  try {
    const start = new Date(session.startsAt);
    const end = new Date(start.getTime() + activity.durationMinutes * 60_000);
    const result = await createEventInCalendarAsync({
      title: activity.title,
      startDate: start,
      endDate: end,
      location: session.placeLabel,
      timeZone: activity.timezone,
    });
    // Android reports 'done' whatever the user did, so only an explicit cancel is told apart.
    return result.action === 'canceled' ? 'cancelled' : 'added';
  } catch {
    return 'unavailable';
  }
}
