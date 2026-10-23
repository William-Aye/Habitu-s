import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../account/useSession';
import { setupNotificationCategories } from './categories';
import { refreshPushRegistration } from './registerPush';
import { handleNotificationResponse, openActivityFor, responseKey } from './responses';

type Response = Notifications.NotificationResponse;

/** A response not yet answered, tied to the user who was current when it arrived (null while signed out). */
interface Held {
  response: Response;
  userId: string | null;
}

/**
 * Registers the reminder actions, keeps the push token fresh, and routes notification taps: the one
 * that cold-started the app and those received while it runs. An answer ("Oui" / "Pas cette fois") is
 * recorded only once the user is signed in with a profile; before that the response is held, the
 * activity page opens once (its account gate does the rest) and the response is handled when ready.
 * A response held for one user is never answered for a different user.
 */
export function NotificationResponder() {
  const { status, userId } = useSession();
  const { i18n } = useTranslation();
  const statusRef = useRef(status);
  const userRef = useRef<string | null>(userId);
  const prevUser = useRef<string | null>(userId);
  const pending = useRef<Held | null>(null);
  const opened = useRef(new Set<string>());
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
    userRef.current = userId;
    // Signing out forgets what was waiting for the user who left.
    if (!userId && prevUser.current) pending.current = null;
    prevUser.current = userId;
  }, [status, userId]);

  // Button labels are translated, so they are registered again when the language changes.
  useEffect(() => {
    void setupNotificationCategories();
  }, [i18n.language]);

  /** Opens the activity once per response; clears the system's copy so a later launch does not replay it. */
  const openOnce = (r: Response) => {
    const key = responseKey(r);
    if (opened.current.has(key)) return;
    opened.current.add(key);
    openActivityFor(r);
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
  };

  const answer = async (held: Held) => {
    const key = responseKey(held.response);
    const alreadyOpened = opened.current.has(key);
    if (held.userId && held.userId !== userRef.current) {
      openOnce(held.response); // another person is signed in now: show the activity, record nothing
      return;
    }
    await handleNotificationResponse(held.response, { alreadyOpened });
  };

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const held = { response: r, userId: userRef.current };
      if (statusRef.current === 'ready') {
        void answer(held);
        return;
      }
      pending.current = held;
      if (statusRef.current !== 'loading') openOnce(r);
    });
    return () => sub.remove();
    // answer and openOnce only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          if (held) await answer(held);
          if (last && (!held || responseKey(held.response) !== responseKey(last))) {
            await answer({ response: last, userId });
          }
          if (last) await Notifications.clearLastNotificationResponseAsync();
        } else {
          if (last && !pending.current) pending.current = { response: last, userId };
          if (pending.current) openOnce(pending.current.response);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // answer and openOnce only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId]);

  // Permission already granted: register the token (never prompts), once per launch per user and when it changes.
  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    if (registeredFor.current !== userId) {
      registeredFor.current = userId;
      void refreshPushRegistration();
    }
    const sub = Notifications.addPushTokenListener(() => {
      void refreshPushRegistration();
    });
    return () => sub.remove();
  }, [status, userId]);

  return null;
}
