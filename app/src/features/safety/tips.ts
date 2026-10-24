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
}
let cache: Cache = { owner: null, seen: null, loading: null };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Test hook: forget the shared copy (as after an app restart). */
export function resetTipsCache() {
  cache = { owner: null, seen: null, loading: null };
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

async function load(owner: string | null): Promise<Set<string> | null> {
  const local = await readLocal();
  if (owner === null) return new Set(local);
  // Signed in: copy what was dismissed while signed out, then drop the local copy once it is safe on the server.
  let copied = false;
  if (local.length > 0) {
    const r = await markTipsSeen(local);
    copied = r.ok;
    if (r.ok) {
      try {
        await AsyncStorage.removeItem(STORAGE_KEY);
      } catch {
        // Harmless: the next sync writes the same rows again.
      }
    }
  }
  const server = await listSeenTips();
  if (!server.ok) return local.length > 0 && !copied ? new Set(local) : null;
  return new Set([...server.tips, ...local]);
}

function ensureLoaded(owner: string | null) {
  if (cache.owner !== owner) cache = { owner, seen: null, loading: null };
  if (cache.seen || cache.loading) return;
  const mine = cache;
  mine.loading = load(owner)
    .then((seen) => {
      if (cache === mine) mine.seen = seen;
    })
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
    const set = cache.owner === owner && cache.seen ? cache.seen : new Set<string>();
    set.add(id);
    if (cache.owner === owner) cache.seen = set;
    notify();
    if (owner === null) await writeLocal([...set]);
    else await markTipsSeen([id]);
  }, [owner, id]);

  return { seen, dismiss };
}
