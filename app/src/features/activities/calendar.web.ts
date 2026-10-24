import { activityUrl, webBaseUrl } from '../../lib/links';
import { buildIcs } from './ics';
import type { ActivityPage, SessionInfo } from './types';

export type CalendarResult = 'added' | 'cancelled' | 'unavailable';

/** The browser has no calendar to open: it downloads an .ics file the visitor's calendar app can import. */
export async function addSessionToCalendar(
  session: Pick<SessionInfo, 'id' | 'startsAt' | 'placeLabel'>,
  activity: Pick<ActivityPage, 'id' | 'title'>,
): Promise<CalendarResult> {
  try {
    const ics = buildIcs(session, activity, activityUrl(activity.id, activity.title, webBaseUrl() || window.location.origin));
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `habitues-${new Date(session.startsAt).toISOString().slice(0, 10)}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return 'added';
  } catch {
    return 'unavailable';
  }
}
