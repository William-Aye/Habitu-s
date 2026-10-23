/** A tiny signal: "the unread total may have changed" (a discussion was just marked read). */
const listeners = new Set<() => void>();

export function onUnreadChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitUnreadChanged(): void {
  [...listeners].forEach((l) => l());
}
