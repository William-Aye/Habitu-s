import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../account/useSession';
import { hasLocalInterests, mergeLocalIntoAccount } from './store';

/** A failed merge keeps the local interests for the next attempt; the log carries no user data. */
export async function mergeInterests(userId: string): Promise<void> {
  try {
    await mergeLocalIntoAccount(userId);
  } catch {
    console.warn('interests merge failed');
  }
}

/**
 * Interests picked while signed out are merged into the account whenever the session is ready and the
 * app returns to the foreground, so a recovered session or a failed earlier merge never strands them.
 */
export function InterestsMerger() {
  const { status, userId } = useSession();
  const running = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    let active = true;
    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        if (active && (await hasLocalInterests())) await mergeInterests(userId);
      } catch {
        console.warn('interests merge failed');
      } finally {
        running.current = false;
      }
    };
    void run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [status, userId]);
  return null;
}
