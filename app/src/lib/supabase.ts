import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { secureSessionStorage } from './secureSessionStorage';
import { bannedAwareFetch } from './bannedSignal';
import type { Database } from './database.types';

export function createSupabaseClient(
  url: string | undefined,
  anonKey: string | undefined,
): SupabaseClient<Database> {
  if (!url || !anonKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY');
  }
  const web = Platform.OS === 'web';
  return createClient<Database>(url, anonKey, {
    global: { fetch: bannedAwareFetch },
    auth: {
      storage: secureSessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      // On the web the Google sign-in returns to /app/auth/callback with a PKCE code, which that
      // route exchanges itself; nothing is read from the URL anywhere else.
      detectSessionInUrl: false,
      ...(web ? { flowType: 'pkce' as const } : {}),
    },
  });
}

export const supabase = createSupabaseClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);
