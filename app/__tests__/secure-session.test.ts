import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { secureSessionStorage } from '../src/lib/secureSessionStorage';
import { createSupabaseClient } from '../src/lib/supabase';

jest.mock('@supabase/supabase-js', () => {
  const actual = jest.requireActual('@supabase/supabase-js');
  return { ...actual, createClient: jest.fn(actual.createClient) };
});

const KEY = 'sb-127-auth-token';
const VALUE = JSON.stringify({ access_token: 'abc.def.ghi', refresh_token: 'r-123', user: { id: 'u1' } });
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(async () => {
  await AsyncStorage.clear();
  store.clear();
  
});

it('round-trips a value', async () => {
  await secureSessionStorage.setItem(KEY, VALUE);
  expect(await secureSessionStorage.getItem(KEY)).toBe(VALUE);
});

it('never leaves the plain value in AsyncStorage', async () => {
  await secureSessionStorage.setItem(KEY, VALUE);
  const keys = await AsyncStorage.getAllKeys();
  expect(keys).toContain(`enc_${KEY}`);
  for (const k of keys) {
    const v = (await AsyncStorage.getItem(k)) ?? '';
    expect(v).not.toContain('abc.def.ghi');
    expect(v).not.toContain('r-123');
  }
  expect(store.has(`sk_${KEY}`)).toBe(true);
});

it('migrates a plain value from the old adapter once', async () => {
  await AsyncStorage.setItem(KEY, VALUE);
  expect(await secureSessionStorage.getItem(KEY)).toBe(VALUE);
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
  expect(await AsyncStorage.getItem(`enc_${KEY}`)).not.toBeNull();
  expect(await secureSessionStorage.getItem(KEY)).toBe(VALUE);
});

it('returns null and clears both when SecureStore throws', async () => {
  await secureSessionStorage.setItem(KEY, VALUE);
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore'));
  expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  expect(await AsyncStorage.getItem(`enc_${KEY}`)).toBeNull();
  expect(store.has(`sk_${KEY}`)).toBe(false);
});

it('returns null on corrupt ciphertext', async () => {
  await secureSessionStorage.setItem(KEY, VALUE);
  await AsyncStorage.setItem(`enc_${KEY}`, 'zz-not-hex');
  expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  expect(await AsyncStorage.getItem(`enc_${KEY}`)).toBeNull();
  expect(store.has(`sk_${KEY}`)).toBe(false);
});

it('removeItem clears both', async () => {
  await secureSessionStorage.setItem(KEY, VALUE);
  await secureSessionStorage.removeItem(KEY);
  expect(await AsyncStorage.getItem(`enc_${KEY}`)).toBeNull();
  expect(store.has(`sk_${KEY}`)).toBe(false);
  expect(await secureSessionStorage.getItem(KEY)).toBeNull();
});

it('createSupabaseClient uses secureSessionStorage', () => {
  createSupabaseClient('http://127.0.0.1:55321', 'k');
  expect((createClient as jest.Mock).mock.calls.at(-1)[2].auth.storage).toBe(secureSessionStorage);
});
