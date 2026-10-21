// Load app/.env (git-ignored) like Expo does; fall back to dummy values so the
// default client can be built when no .env exists (e.g. CI).
try {
  require('@expo/env').load(__dirname);
} catch {}
process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:55321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';
