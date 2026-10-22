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

// Listeners told when the stored interests changed behind the hooks' back (the sign-in merge).
const listeners = new Set<() => void>();
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
    const local = await readLocal();
    if (level === null) delete local[categoryId];
    else local[categoryId] = level;
    await AsyncStorage.setItem(LOCAL_KEY, JSON.stringify(local));
    return;
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

/** Upserts local entries that are stronger than the stored ones (love > like > curious), then clears the local key. */
export async function mergeLocalIntoAccount(userId: string): Promise<void> {
  const local = await readLocal();
  const ids = Object.keys(local);
  if (ids.length > 0) {
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
  }
  await AsyncStorage.removeItem(LOCAL_KEY);
  listeners.forEach((fn) => fn());
}

export function useInterests(): {
  interests: Interests;
  setLevel(categoryId: string, level: Level | null): void;
  loading: boolean;
} {
  const { status, userId } = useSession();
  const [interests, setInterests] = useState<Interests>({});
  const [loading, setLoading] = useState(true);
  const [reloads, setReloads] = useState(0);
  const userRef = useRef<string | null>(userId);
  useEffect(() => {
    userRef.current = userId;
  }, [userId]);

  // While the session is unknown (no user id yet), do not read the local list.
  const unknown = status === 'loading' && !userId;

  useEffect(() => subscribeInterestsChanged(() => setReloads((n) => n + 1)), []);

  useEffect(() => {
    if (unknown) return;
    let active = true;
    getInterests(userId)
      .then((v) => active && setInterests(v))
      .catch(() => active && setInterests({}))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [unknown, userId, reloads]);

  const set = useCallback((categoryId: string, level: Level | null) => {
    let previous: Level | null = null;
    setInterests((cur) => {
      previous = cur[categoryId] ?? null;
      const next = { ...cur };
      if (level === null) delete next[categoryId];
      else next[categoryId] = level;
      return next;
    });
    setLevel(userRef.current, categoryId, level).catch(() => {
      setInterests((cur) => {
        const next = { ...cur };
        if (previous === null) delete next[categoryId];
        else next[categoryId] = previous;
        return next;
      });
    });
  }, []);

  return { interests, setLevel: set, loading };
}
