jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
import { createSupabaseClient } from '../src/lib/supabase';

const MISSING = 'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY';

it.each([[undefined, 'k'], ['', 'k'], ['http://127.0.0.1:55321', undefined], ['http://127.0.0.1:55321', '']])(
  'throws a clear error when url=%p key=%p', (url, key) => {
    expect(() => createSupabaseClient(url, key)).toThrow(MISSING);
  });

it('creates a client when both values are set', () => {
  expect(createSupabaseClient('http://127.0.0.1:55321', 'test-key').from).toBeInstanceOf(Function);
});
