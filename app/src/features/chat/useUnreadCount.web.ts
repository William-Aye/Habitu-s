/** Chat is not on the web build: there is never a badge to show. */
export function useUnreadCount(): { count: number; refresh: () => void } {
  return { count: 0, refresh: () => {} };
}
