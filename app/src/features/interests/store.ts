import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../account/useSession';

export type Level = 'like' | 'love' | 'curious';
export type Interests = Record<string, Level>;

const LOCAL_KEY = 'interests.local';
const STRENGTH: Record<Level, number> = { curious: 1, like: 2, love: 3 };

function isLevel(v: unknown): v is Level {
  return v === 'like' || v === 'love' || v === 'curious';
}

function clean(raw: unknown): Interests {
  const out: Interests = {};
  if (raw && typeof raw === 'object') {
    for (const [id, level] of Object.entries(raw)) if (isLevel(level)) out[id] = level;
  }
  return out;
}

async function readLocal(): Promise<Interests> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_KEY);
    return raw ? clean(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

// Local read-modify-write cycles run one after another so quick taps never overwrite each other.
let localQueue: Promise<unknown> = Promise.resolve();
function serialised<T>(job: () => Promise<T>): Promise<T> {
  const run = localQueue.then(job, job);
  localQueue = run.catch(() => undefined);
  return run;
}

// Listeners told when the stored interests changed behind the hooks' back (the sign-in merge).
const listeners = new Set<() => void>();
/** Tells the interests hooks to re-read (after the sign-in merge, or after local data was wiped). */
export function notifyInterestsChanged(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeInterestsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function nextTapLevel(current: Level | null): Level | null {
  if (current === 'like') return 'love';
  if (current === 'love') return null;
  return 'like';
}

export async function getInterests(userId: string | null): Promise<Interests> {
  if (!userId) return readLocal();
  const { data, error } = await supabase
    .from('user_interests')
    .select('category_id, level')
    .eq('user_id', userId);
  if (error) throw new Error('interests read failed');
  const out: Interests = {};
  for (const row of data ?? []) if (isLevel(row.level)) out[row.category_id] = row.level;
  return out;
}

export async function setLevel(
  userId: string | null,
  categoryId: string,
  level: Level | null,
): Promise<void> {
  if (!userId) {
    return serialised(async () => {
      const local = await readLocal();
      if (level === null) delete local[categoryId];
      else local[categoryId] = level;
      await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(local));
    });
  }
  if (level === null) {
    const { error } = await supabase
      .from('user_interests')
      .delete()
      .eq('user_id', userId)
      .eq('category_id', categoryId);
    if (error) throw new Error('interests write failed');
    return;
  }
  const { error } = await supabase
    .from('user_interests')
    .upsert({ user_id: userId, category_id: categoryId, level }, { onConflict: 'user_id,category_id' });
  if (error) throw new Error('interests write failed');
}

/**
 * One merge pass. Removes from the local list only what it merged unchanged; a tap made while the upload
 * ran stays local, and a deletion made meanwhile is applied to the account. Returns true if entries remain.
 */
async function mergePass(userId: string): Promise<boolean> {
  const local = await readLocal();
  const ids = Object.keys(local);
  if (ids.length === 0) {
    await serialised(() => AsyncStorage.removeItem(LOCAL_KEY));
    return false;
  }
  const account = await getInterests(userId);
  const rows = ids
    .filter((id) => !account[id] || STRENGTH[local[id]] > STRENGTH[account[id]])
    .map((id) => ({ user_id: userId, category_id: id, level: local[id] }));
  if (rows.length > 0) {
    const { error } = await supabase
      .from('user_interests')
      .upsert(rows, { onConflict: 'user_id,category_id' });
    if (error) throw new Error('interests merge failed');
  }
  let deleted: string[] = [];
  let leftover = false;
  await serialised(async () => {
    const rest = await readLocal();
    deleted = ids.filter((id) => !(id in rest));
    for (const id of ids) if (rest[id] === local[id]) delete rest[id];
    leftover = Object.keys(rest).length > 0;
    if (leftover) await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(rest));
    else await AsyncStorage.removeItem(LOCAL_KEY);
  });
  for (const id of deleted) {
    const { error } = await supabase
      .from('user_interests')
      .delete()
      .eq('user_id', userId)
      .eq('category_id', id);
    if (error) throw new Error('interests merge failed');
  }
  return leftover;
}

/** Upserts local entries that are stronger than the stored ones (love > like > curious), then clears the local key. */
export async function mergeLocalIntoAccount(userId: string): Promise<void> {
  // One extra pass picks up taps made during the first upload; anything later waits for the next sign-in.
  if (await mergePass(userId)) await mergePass(userId);
  notifyInterestsChanged();
}

interface Loaded {
  key: string;
  interests: Interests;
  error: boolean;
}

export function useInterests(): {
  interests: Interests;
  setLevel(categoryId: string, level: Level | null): void;
  loading: boolean;
  error: boolean;
} {
  const { status, userId } = useSession();
  const key = userId ?? 'local';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloads, setReloads] = useState(0);
  const userRef = useRef<string | null>(userId);
  const latest = useRef<Interests>({});
  const versions = useRef<Record<string, number>>({});
  useEffect(() => {
    userRef.current = userId;
  }, [userId]);

  // While the session is unknown (no user id yet), do not read the local list.
  const unknown = status === 'loading' && !userId;

  useEffect(() => subscribeInterestsChanged(() => setReloads((n) => n + 1)), []);

  useEffect(() => {
    if (unknown) return;
    let active = true;
    latest.current = {};
    getInterests(userId)
      .then((v) => {
        if (!active) return;
        latest.current = v;
        setLoaded({ key, interests: v, error: false });
      })
      .catch(() => {
        if (!active) return;
        // Keep what is shown for the same user; never wipe it on a failed read.
        setLoaded((cur) => ({ key, interests: cur?.key === key ? cur.interests : {}, error: true }));
      });
    return () => {
      active = false;
    };
  }, [unknown, userId, key, reloads]);

  const current = loaded && loaded.key === key ? loaded : null;

  const set = useCallback((categoryId: string, level: Level | null) => {
    const apply = (cur: Interests, value: Level | null): Interests => {
      const next = { ...cur };
      if (value === null) delete next[categoryId];
      else next[categoryId] = value;
      return next;
    };
    const k = userRef.current ?? 'local';
    const previous = latest.current[categoryId] ?? null;
    const version = (versions.current[categoryId] = (versions.current[categoryId] ?? 0) + 1);
    latest.current = apply(latest.current, level);
    setLoaded((cur) => ({ key: k, interests: latest.current, error: cur?.error ?? false }));
    setLevel(userRef.current, categoryId, level).catch(() => {
      // Only undo if nothing newer touched this category since.
      if (versions.current[categoryId] !== version) return;
      latest.current = apply(latest.current, previous);
      setLoaded((cur) => ({ key: k, interests: latest.current, error: cur?.error ?? false }));
    });
  }, []);

  return {
    interests: current?.interests ?? {},
    setLevel: set,
    loading: unknown || !current,
    error: current?.error ?? false,
  };
}
