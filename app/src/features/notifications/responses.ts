import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { setAttendance } from '../activities/api';

const handled = new Set<string>();
const inFlight = new Set<string>();

export function resetHandledResponsesForTests(): void {
  handled.clear();
  inFlight.clear();
}

export function responseKey(response: Notifications.NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.actionIdentifier}`;
}

function payload(response: Notifications.NotificationResponse) {
  const data = (response.notification.request.content.data ?? {}) as {
    session_id?: unknown;
    activity_id?: unknown;
  };
  return {
    sessionId: typeof data.session_id === 'string' ? data.session_id : null,
    activityId: typeof data.activity_id === 'string' ? data.activity_id : null,
  };
}

/** Only navigates to the activity (its page shows the account gate to a signed-out user); records nothing. */
export function openActivityFor(response: Notifications.NotificationResponse): void {
  const { activityId } = payload(response);
  if (activityId) router.push({ pathname: '/activites/[id]', params: { id: activityId } });
}

/**
 * Reacts to a tap on a notification or one of its actions. The same response can reach the app twice
 * (cold-start lookup and live listener), so each is handled once, marked only after the attempt ends.
 * If an answer cannot be recorded, the activity still opens with a flag so its page can say so.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  opts: { alreadyOpened?: boolean } = {},
): Promise<void> {
  const key = responseKey(response);
  if (handled.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  const { sessionId, activityId } = payload(response);
  let failed = false;
  try {
    const answer =
      response.actionIdentifier === 'yes' ? 'confirmed' : response.actionIdentifier === 'no' ? 'cancelled' : null;
    if (sessionId && answer) {
      try {
        const r = await setAttendance(sessionId, answer, 0);
        failed = !r.ok;
      } catch {
        failed = true;
      }
    }
  } finally {
    inFlight.delete(key);
    handled.add(key);
  }
  if (!activityId) return;
  if (!opts.alreadyOpened) {
    router.push({
      pathname: '/activites/[id]',
      params: failed ? { id: activityId, reminder: 'failed' } : { id: activityId },
    });
  } else if (failed) {
    // The page is already on screen (opened while signed out): update it instead of stacking another.
    router.replace({ pathname: '/activites/[id]', params: { id: activityId, reminder: 'failed' } });
  }
}
