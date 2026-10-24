import type { PendingMessage } from './types';

// Chat does not exist on the website: no queue, no storage, no connectivity listener (NetInfo polls
// the network and costs requests). Same functions as outbox.ts, all inert, so shared code
// (sign-out, session) keeps working.

export function ready(): Promise<void> {
  return Promise.resolve();
}
export function pending(_activityId: string, _userId: string): PendingMessage[] {
  return [];
}
export function subscribe(_listener: () => void): () => void {
  return () => {};
}
export function flush(): Promise<void> {
  return Promise.resolve();
}
export function enqueue(_userId: string, _activityId: string, _body: string): PendingMessage | null {
  return null;
}
export function retry(_id: string): Promise<void> {
  return Promise.resolve();
}
export function discard(_id: string): void {}
export async function clearOutbox(): Promise<void> {}
export function initOutbox(): void {}
