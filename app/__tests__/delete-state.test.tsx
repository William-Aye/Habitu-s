import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';
import { deleteMyAccount } from '../src/features/account/myData';
import { useInterests } from '../src/features/interests/store';
import { useExploreLocation } from '../src/features/explore/useExploreLocation';

jest.mock('expo-location', () => ({}));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('expo-sharing', () => ({}));
jest.mock('../src/features/account/auth', () => ({ signOut: jest.fn(async () => undefined) }));
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ status: 'signed_out', userId: null, profile: null, error: false, refresh: jest.fn() }),
}));
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(async () => ({ data: null, error: null })),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: jest.fn() }) },
  },
}));

it('after deleting the account the interests hook and Explore location are empty', async () => {
  await AsyncStorage.setItem('interests.local', JSON.stringify({ c1: 'love' }));
  await AsyncStorage.setItem(
    'explore.location',
    JSON.stringify({ label: 'Lyon', lon: 4.8, lat: 45.7, source: 'town' }),
  );
  const interests = await renderHook(() => useInterests());
  const location = await renderHook(() => useExploreLocation());
  await waitFor(() => expect(interests.result.current.interests).toEqual({ c1: 'love' }));
  await waitFor(() => expect(location.result.current.location?.label).toBe('Lyon'));

  expect(await deleteMyAccount()).toEqual({ ok: true });

  await waitFor(() => expect(interests.result.current.interests).toEqual({}));
  await waitFor(() => expect(location.result.current.location).toBeNull());
});
