import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { AppState } from 'react-native';

import { sendMessage } from './api';
import type { PendingMessage } from './types';

const KEY = 'chat.outbox.v1';
const MAX_BODY = 2000;

let queue: PendingMessage[] = [];
const listeners = new Set<() => void>();
let flushing: Promise<void> | null = null;
let writing: Promise<void> = Promise.resolve();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  const snapshot = JSON.stringify(queue);
  writing = writing.then(() => AsyncStorage.setItem(KEY, snapshot)).catch(() => {});
}

const loaded: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const stored: PendingMessage[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(stored)) {
      // What was stored before this start-up goes first; anything enqueued meanwhile keeps its place after.
      const known = new Set(queue.map((m) => m.id));
      queue = [...stored.filter((m) => !known.has(m.id)), ...queue];
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

export function pending(activityId: string): PendingMessage[] {
  return queue.filter((m) => m.activityId === activityId);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(id: string, patch: (m: PendingMessage) => PendingMessage | null) {
  queue = queue.flatMap((m) => (m.id === id ? (patch(m) ?? []) : [m]));
  persist();
  emit();
}

async function pass(): Promise<void> {
  await loaded;
  const tried = new Set<string>();
  // Messages enqueued while sending join the same run; a network failure is tried once per run.
  for (;;) {
    const next = queue.find((m) => m.state === 'sending' && !tried.has(m.id));
    if (!next) {
      // Cleared in the same tick as the last look at the queue, so a later flush never joins a finished run.
      flushing = null;
      return;
    }
    tried.add(next.id);
    const res = await sendMessage(next.activityId, next.id, next.body);
    if (res.ok) update(next.id, () => null);
    else if (res.error !== 'network') update(next.id, (m) => ({ ...m, state: 'failed', error: res.error }));
  }
}

/** Sends the queue in creation order. Concurrent calls share one run, so nothing is sent twice. */
export function flush(): Promise<void> {
  flushing ??= pass();
  return flushing;
}

/** Queues a message and starts sending. Returns null for an empty or too long body. */
export function enqueue(activityId: string, body: string): PendingMessage | null {
  const text = body.trim();
  if (!text || text.length > MAX_BODY) return null;
  const message: PendingMessage = {
    id: randomUUID(),
    activityId,
    body: text,
    createdAt: new Date().toISOString(),
    state: 'sending',
  };
  queue = [...queue, message];
  persist();
  emit();
  void flush();
  return message;
}

export function retry(id: string): Promise<void> {
  if (!queue.some((m) => m.id === id)) return Promise.resolve();
  update(id, ({ error: _error, ...rest }) => ({ ...rest, state: 'sending' }));
  return flush();
}

export function discard(id: string): void {
  update(id, () => null);
}

// Back online or back in the foreground: try again.
try {
  NetInfo.addEventListener((state) => {
    if (state.isConnected) void flush();
  });
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void flush();
  });
} catch {
  // No native modules (tests, previews): the queue still flushes on enqueue.
}
// A queue restored from a previous run goes out as soon as it is loaded.
void flush();
