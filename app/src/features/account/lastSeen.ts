import { supabase } from '../../lib/supabase';

const HOUR_MS = 60 * 60 * 1000;
let lastCall = 0;

/** Tells the server the user is active; at most once an hour per app run, errors ignored. */
export async function touchLastSeen(): Promise<void> {
  const now = Date.now();
  if (lastCall !== 0 && now - lastCall < HOUR_MS) return;
  lastCall = now;
  try {
    await supabase.rpc('touch_last_seen');
  } catch {
    // Best effort: the next foreground retries.
  }
}

export function resetLastSeenForTests(): void {
  lastCall = 0;
}
