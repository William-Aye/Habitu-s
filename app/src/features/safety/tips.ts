import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../account/useSession';
import { listSeenTips, markTipsSeen } from './tipsApi';

export type TipId = 'where' | 'first_session' | 'moved_place';

/** i18n keys of the lines of each tip. */
export const TIPS: Record<TipId, string[]> = {
  where: ['create.where.homeTip'],
  first_session: ['safety.tips.first_session.a', 'safety.tips.first_session.b'],
  moved_place: ['safety.tips.moved_place'],
};

const STORAGE_KEY = 'tips.seen.v1';

// One shared copy of "what has been dismissed" per account, so ten session rows read the server once.
interface Cache {
  owner: string | null; // user id, or null when signed out
  seen: Set<string> | null; // null: not known yet (or not readable)
  loading: Promise<void> | null;
  added: Set<string>; // dismissed while the first load was still running
  unsynced: Set<string>; // dismissed but not yet written to the server
}
const fresh = (owner: string | null): Cache => ({
  owner,
  seen: null,
  loading: null,
  added: new Set(),
  unsynced: new Set(),
});
let cache: Cache = fresh(null);
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Test hook: forget the shared copy (as after an app restart). */
export function resetTipsCache() {
  cache = fresh(null);
}

async function readLocal(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeLocal(ids: string[]) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // The tip simply shows again next time.
  }
}

async function clearLocal() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Harmless.
  }
}

async function load(owner: string | null, c: Cache): Promise<Set<string> | null> {
  const local = await readLocal();
  if (owner === null) return new Set(local);
  // Signed in: the signed-out list is copied once (first sign-in after it was written), then dropped,
  // so on a shared device the next account never inherits it. A failed copy is retried from memory.
  if (local.length > 0) {
    const r = await markTipsSeen(local);
    if (!r.ok) local.forEach((id) => c.unsynced.add(id));
    await clearLocal();
  }
  const server = await listSeenTips();
  if (!server.ok) return local.length > 0 ? new Set(local) : null;
  return new Set([...server.tips, ...local]);
}

async function flushUnsynced(c: Cache) {
  if (c.owner === null || c.unsynced.size === 0) return;
  const ids = [...c.unsynced];
  const r = await markTipsSeen(ids);
  if (r.ok) ids.forEach((id) => c.unsynced.delete(id));
}

function ensureLoaded(owner: string | null) {
  let clearing: Promise<void> = Promise.resolve();
  if (cache.owner !== owner) {
    // An account signing out leaves nothing behind for the next person.
    if (cache.owner !== null && owner === null) clearing = clearLocal();
    cache = fresh(owner);
  }
  const mine = cache;
  if (mine.seen || mine.loading) {
    void flushUnsynced(mine);
    return;
  }
  mine.loading = (async () => {
    await clearing; // clearing on sign-out must finish before the signed-out list is read
    const seen = await load(owner, mine);
    if (cache === mine) mine.seen = seen ? new Set([...seen, ...mine.added]) : null;
  })()
    .catch(() => {})
    .finally(() => {
      mine.loading = null;
      if (cache === mine) notify();
    });
}

/**
 * Whether a tip was already dismissed. Until that is known (or when the server cannot be read) it
 * reports "seen", so a tip never flashes up and is never shown twice by mistake.
 */
export function useTipSeen(id: string): { seen: boolean; dismiss: () => Promise<void> } {
  const { status, userId } = useSession();
  const owner = status === 'ready' && userId ? userId : status === 'signed_out' ? null : undefined;
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  useEffect(() => {
    if (owner !== undefined) ensureLoaded(owner);
  }, [owner]);

  const known = owner !== undefined && cache.owner === owner ? cache.seen : null;
  const seen = known ? known.has(id) : true;

  const dismiss = useCallback(async () => {
    if (owner === undefined) return;
    ensureLoaded(owner);
    const c = cache;
    c.added.add(id);
    c.seen?.add(id);
    notify();
    if (owner === null) {
      await writeLocal([...new Set([...c.added, ...(c.seen ?? [])])]);
      return;
    }
    c.unsynced.add(id);
    await flushUnsynced(c);
  }, [owner, id]);

  return { seen, dismiss };
}
