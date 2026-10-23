import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../account/useSession';
import { myChats } from './api';

/**
 * Total of unread messages across the user's discussions, for the tab badge. Re-read on mount, when
 * the app returns to the foreground, when the account changes and whenever refresh() is called
 * (the layout calls it when a tab gets focus). Signed out means zero, with no call.
 */
export function useUnreadCount(): { count: number; refresh: () => void } {
  const { status, userId } = useSession();
  const [count, setCount] = useState(0);
  const requestId = useRef(0);

  const refresh = useCallback(() => {
    const id = ++requestId.current;
    if (status === 'loading') return;
    if (status !== 'ready' || !userId) return; // reported as zero below, no call
    myChats()
      .then((r) => {
        if (id !== requestId.current) return; // a newer read superseded this one
        if (r.ok) setCount(r.chats.reduce((sum, c) => sum + c.unreadCount, 0));
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

  return { count: status === 'ready' && userId ? count : 0, refresh };
}
