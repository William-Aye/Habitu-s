import { supabase } from '../../lib/supabase';

const HOUR_MS = 60 * 60 * 1000;
let lastCall = 0;
let lastUser: string | null = null;

/** Tells the server the user is active; at most once an hour per app run, errors ignored. */
export async function touchLastSeen(userId: string | null = null): Promise<void> {
  const now = Date.now();
  if (userId !== lastUser) lastCall = 0; // another user: the throttle starts over
  if (lastCall !== 0 && now - lastCall < HOUR_MS) return;
  lastCall = now;
  lastUser = userId;
  try {
    const { error } = await supabase.rpc('touch_last_seen');
    if (error) lastCall = 0;
  } catch {
    lastCall = 0; // failed: the next foreground retries
  }
}

export function resetLastSeenForTests(): void {
  lastCall = 0;
  lastUser = null;
}
