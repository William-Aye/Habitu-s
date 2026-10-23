import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../account/useSession';
import { unreadTotal } from './api';
import { onUnreadChanged } from './unreadEvents';

/**
 * Total of unread messages across the user's discussions, for the tab badge. Re-read on mount, when
 * the app returns to the foreground, when a chat notification arrives, when a discussion has just been
 * marked read, when the account changes and whenever refresh() is called (the layout calls it when a tab
 * gets focus). Signed out means zero, with no call.
 */
export function useUnreadCount(): { count: number; refresh: () => void } {
  const { status, userId } = useSession();
  const [count, setCount] = useState(0);
  const requestId = useRef(0);

  const refresh = useCallback(() => {
    const id = ++requestId.current;
    if (status === 'loading') return;
    if (status !== 'ready' || !userId) return; // reported as zero below, no call
    unreadTotal()
      .then((r) => {
        if (id !== requestId.current) return; // a newer read superseded this one
        if (r.ok) setCount(r.total);
        else if (r.error === 'signed_out') setCount(0);
        // Any other failure keeps the last known number.
      })
      .catch(() => {});
  }, [status, userId]);

  useEffect(() => {
    const counter = requestId;
    refresh();
    return () => {
      counter.current++;
    };
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // A discreet chat push that arrives while the app is open.
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      if (n?.request?.content?.data?.kind === 'chat_message') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // The discussion screen marks a discussion read as it is left, then says so: no timer, no race.
  useEffect(() => onUnreadChanged(refresh), [refresh]);

  return { count: status === 'ready' && userId ? count : 0, refresh };
}
