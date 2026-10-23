import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';

import { supabase } from '../../lib/supabase';
import { sendMessage } from './api';
import type { PendingMessage } from './types';

const KEY = 'chat.outbox.v2';
const OLD_KEY = 'chat.outbox.v1'; // had no owner: never sent again
const MAX_BODY = 2000;
const STALLED_ATTEMPTS = 3;
const STALLED_AFTER_MS = 2 * 60 * 1000;
const BACKOFF_MS = [5_000, 15_000, 60_000];

type Stored = Omit<PendingMessage, 'stalled'>;

let queue: Stored[] = [];
const listeners = new Set<() => void>();
let flushing: Promise<void> | null = null;
let dirty = false;
let writing: Promise<void> = Promise.resolve();
let initialised = false;
let foreground = AppState.currentState !== 'background';
let timer: ReturnType<typeof setTimeout> | null = null;
let backoffStep = 0;

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  const snapshot = JSON.stringify(queue);
  writing = writing.then(() => AsyncStorage.setItem(KEY, snapshot)).catch(() => {});
}

const isStored = (m: unknown): m is Stored => {
  if (!m || typeof m !== 'object') return false;
  const x = m as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.userId === 'string' &&
    x.userId !== '' &&
    typeof x.activityId === 'string' &&
    typeof x.body === 'string' &&
    typeof x.createdAt === 'string' &&
    (x.state === 'sending' || x.state === 'failed') &&
    typeof x.attempts === 'number'
  );
};

const loaded: Promise<void> = (async () => {
  try {
    AsyncStorage.removeItem(OLD_KEY).catch(() => {});
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      // What was stored before this start-up goes first; anything enqueued meanwhile keeps its place after.
      const known = new Set(queue.map((m) => m.id));
      queue = [...parsed.filter(isStored).filter((m) => !known.has(m.id)), ...queue];
    }
  } catch {
    // An unreadable queue is dropped rather than blocking the chat.
  }
  emit();
})();

/** Resolves once the persisted queue is loaded. */
export function ready(): Promise<void> {
  return loaded;
}

function withStalled(m: Stored): PendingMessage {
  const stalled =
    m.state === 'sending' &&
    (m.attempts >= STALLED_ATTEMPTS || Date.now() - new Date(m.createdAt).getTime() > STALLED_AFTER_MS);
  return { ...m, stalled };
}

export function pending(activityId: string, userId: string): PendingMessage[] {
  return queue.filter((m) => m.activityId === activityId && m.userId === userId).map(withStalled);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(id: string, patch: (m: Stored) => Stored | null) {
  queue = queue.flatMap((m) => (m.id === id ? (patch(m) ?? []) : [m]));
  persist();
  emit();
}

async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** While the app is open and something is waiting, try again on a growing delay. */
function scheduleRetry() {
  if (!initialised || !foreground || !queue.some((m) => m.state === 'sending')) {
    clearTimer();
    backoffStep = 0;
    return;
  }
  if (timer) return;
  const delay = BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length - 1)];
  backoffStep += 1;
  timer = setTimeout(() => {
    timer = null;
    flush().catch(() => {});
  }, delay);
}

async function pass(): Promise<void> {
  try {
    await loaded;
    do {
      dirty = false;
      // The account is read once per run: only its own messages go out, the rest stay untouched.
      const userId = await currentUserId();
      if (!userId) return; // signed out (or the token could not be refreshed): keep everything queued
      const tried = new Set<string>();
      for (;;) {
        const next = queue.find((m) => m.userId === userId && m.state === 'sending' && !tried.has(m.id));
        if (!next) break;
        tried.add(next.id);
        const res = await sendMessage(next.activityId, next.id, next.body);
        if (res.ok) {
          backoffStep = 0;
          update(next.id, () => null);
        } else if (res.error === 'signed_out') {
          return;
        } else if (res.error === 'network') {
          update(next.id, (m) => ({ ...m, attempts: m.attempts + 1 }));
        } else {
          update(next.id, (m) => ({ ...m, state: 'failed', error: res.error as Stored['error'] }));
        }
      }
      // A flush asked for during the run (reconnect, foreground) gets a fresh pass.
    } while (dirty);
  } finally {
    // Cleared in the same tick as the last look at the queue, so a later flush never joins a finished run.
    flushing = null;
    scheduleRetry();
  }
}

/** Sends the queue in creation order. Concurrent calls share one run, so nothing is sent twice. */
export function flush(): Promise<void> {
  if (flushing) {
    dirty = true;
    return flushing;
  }
  flushing = pass();
  return flushing;
}

/** Starts a run if none is going; a run in progress already picks up newly queued messages. */
function kick() {
  if (!flushing) flushing = pass();
  flushing.catch(() => {});
}

/** Queues a message and starts sending. Returns null for an empty or too long body. */
export function enqueue(userId: string, activityId: string, body: string): PendingMessage | null {
  const text = body.trim();
  if (!userId || !text || text.length > MAX_BODY) return null;
  const message: Stored = {
    id: randomUUID(),
    userId,
    activityId,
    body: text,
    createdAt: new Date().toISOString(),
    state: 'sending',
    attempts: 0,
  };
  queue = [...queue, message];
  persist();
  emit();
  kick();
  return withStalled(message);
}

export function retry(id: string): Promise<void> {
  if (!queue.some((m) => m.id === id)) return Promise.resolve();
  update(id, ({ error: _error, ...rest }) => ({ ...rest, state: 'sending', attempts: 0 }));
  return flush();
}

export function discard(id: string): void {
  update(id, () => null);
}

/** Forgets every unsent message (sign-out, or another account signing in). */
export async function clearOutbox(): Promise<void> {
  queue = [];
  emit();
  await loaded; // a load still in progress would bring the stored queue back
  queue = [];
  persist();
  emit();
  await writing;
  scheduleRetry();
}

/** Starts retrying on reconnect and on return to the foreground. Safe to call more than once. */
export function initOutbox(): void {
  if (initialised) return;
  initialised = true;
  try {
    NetInfo.addEventListener((state) => {
      if (state.isConnected) flush().catch(() => {});
    });
  } catch {
    // No native module (tests, previews): the queue still flushes on enqueue.
  }
  try {
    AppState.addEventListener('change', (state) => {
      foreground = state !== 'background';
      if (state === 'active') {
        backoffStep = 0;
        flush().catch(() => {});
      } else if (!foreground) {
        clearTimer();
      }
    });
  } catch {
    // Same: nothing to listen to.
  }
  // A queue restored from a previous run goes out as soon as it is loaded.
  flush().catch(() => {});
}
