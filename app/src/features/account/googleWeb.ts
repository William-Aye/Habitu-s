import { supabase } from '../../lib/supabase';
import { rememberReturnPath } from './oauthReturn';

/** The Google sign-in page; Supabase brings the visitor back to /app/auth/callback. */
export async function startGoogleOAuth(): Promise<{ error: unknown }> {
  const base = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? '').replace(/\/+$/, '') || window.location.origin;
  rememberReturnPath();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${base}/app/auth/callback` },
  });
  return { error };
}

/** Signing out: nothing of the session may stay in this browser (supabase-js keys all start with "sb-"). */
export function clearWebSession(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i) ?? '');
    for (const key of keys) if (key.startsWith('sb-')) localStorage.removeItem(key);
    sessionStorage.removeItem('auth.returnTo');
  } catch {
    // Storage unavailable: nothing was kept.
  }
}
