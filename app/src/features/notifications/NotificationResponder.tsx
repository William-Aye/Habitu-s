import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { useSession } from '../account/useSession';
import { setupNotificationCategories } from './categories';
import { handleNotificationResponse } from './responses';

/**
 * Registers the reminder actions and routes notification taps: the one that cold-started the app
 * (looked up once) and those received while it runs. Waits for the session so a "Oui" answer is
 * recorded for the signed-in user; handleNotificationResponse ignores a response seen twice.
 */
export function NotificationResponder() {
  const { status } = useSession();

  useEffect(() => {
    void setupNotificationCategories();
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    let active = true;
    Notifications.getLastNotificationResponseAsync()
      .then(async (last) => {
        if (!active || !last) return;
        await handleNotificationResponse(last);
        await Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      void handleNotificationResponse(r);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [status]);

  return null;
}
