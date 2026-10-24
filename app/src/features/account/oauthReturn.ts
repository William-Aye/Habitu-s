import { Platform } from 'react-native';

const KEY = 'auth.returnTo';
/** The web build is served under this path; the router works without it. */
const BASE = '/app';

/** Remembers the page the visitor is on, so the OAuth round trip can bring them back. */
export function rememberReturnPath(): void {
  if (Platform.OS !== 'web') return;
  try {
    const path = window.location.pathname;
    const inApp = path === BASE || path.startsWith(`${BASE}/`) ? path.slice(BASE.length) || '/' : path;
    sessionStorage.setItem(KEY, inApp);
  } catch {
    // Without it the visitor lands on the home page.
  }
}

/** The remembered path, once; only a path inside this site is accepted. */
export function takeReturnPath(): string {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')) return path;
  } catch {
    // Fall through.
  }
  return '/';
}
