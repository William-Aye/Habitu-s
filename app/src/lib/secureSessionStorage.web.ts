// The browser has no secure store: the session lives in localStorage, as supabase-js does by default.
// Every call is guarded, because localStorage can throw (private windows, blocked site data).

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: the visitor stays signed in for this page only.
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove.
    }
  },
};
