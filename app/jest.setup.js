// Load app/.env (git-ignored) like Expo does; fall back to dummy values so the
// default client can be built when no .env exists (e.g. CI).
try {
  require('@expo/env').load(__dirname);
} catch (e) {
  // Only a missing .env is acceptable; anything else is a real problem.
  if (!/\.env|ENOENT/.test(String(e && e.message))) throw e;
}
process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:55321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k);
    }),
  };
});
