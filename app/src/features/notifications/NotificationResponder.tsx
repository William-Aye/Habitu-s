import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../account/useSession';
import { setupNotificationCategories } from './categories';
import { refreshPushRegistration } from './registerPush';
import { handleNotificationResponse, openActivityFor } from './responses';

type Response = Notifications.NotificationResponse;

/**
 * Registers the reminder actions, keeps the push token fresh, and routes notification taps: the one
 * that cold-started the app and those received while it runs. An answer ("Oui" / "Pas cette fois") is
 * recorded only once the user is signed in with a profile; before that the response is held, the
 * activity page opens (its account gate does the rest) and the response is handled when ready.
 */
export function NotificationResponder() {
  const { status } = useSession();
  const { i18n } = useTranslation();
  const statusRef = useRef(status);
  const pending = useRef<Response | null>(null);
  const registered = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Button labels are translated, so they are registered again when the language changes.
  useEffect(() => {
    void setupNotificationCategories();
  }, [i18n.language]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      if (statusRef.current === 'ready') {
        void handleNotificationResponse(r);
        return;
      }
      pending.current = r;
      if (statusRef.current !== 'loading') openActivityFor(r);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (status === 'loading') return;
    let active = true;
    Notifications.getLastNotificationResponseAsync()
      .then(async (last) => {
        if (!active) return;
        if (status === 'ready') {
          const held = pending.current;
          pending.current = null;
          if (held) await handleNotificationResponse(held);
          if (last) {
            await handleNotificationResponse(last);
            await Notifications.clearLastNotificationResponseAsync();
          }
        } else if (last) {
          pending.current = last;
          openActivityFor(last);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [status]);

  // Permission already granted: register the token (never prompts), once per launch and when it changes.
  useEffect(() => {
    if (status !== 'ready') return;
    if (!registered.current) {
      registered.current = true;
      void refreshPushRegistration();
    }
    const sub = Notifications.addPushTokenListener(() => {
      void refreshPushRegistration();
    });
    return () => sub.remove();
  }, [status]);

  return null;
}
