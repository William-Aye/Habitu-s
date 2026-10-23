import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { setAttendance } from '../activities/api';

const handled = new Set<string>();

export function resetHandledResponsesForTests(): void {
  handled.clear();
}

/**
 * Reacts to a tap on a notification or one of its actions. The same response can reach the app twice
 * (cold-start lookup and live listener), so each is handled once.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<void> {
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (handled.has(key)) return;
  handled.add(key);

  const data = (response.notification.request.content.data ?? {}) as {
    session_id?: unknown;
    activity_id?: unknown;
  };
  const sessionId = typeof data.session_id === 'string' ? data.session_id : null;
  const activityId = typeof data.activity_id === 'string' ? data.activity_id : null;

  if (sessionId && response.actionIdentifier === 'yes') {
    await setAttendance(sessionId, 'confirmed', 0);
  } else if (sessionId && response.actionIdentifier === 'no') {
    await setAttendance(sessionId, 'cancelled', 0);
  }
  if (activityId) router.push({ pathname: '/activites/[id]', params: { id: activityId } });
}
