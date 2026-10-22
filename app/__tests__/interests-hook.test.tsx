import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getInterests, setLevel, useInterests } from '../src/features/interests/store';

const mockSession = { userId: 'u1' as string | null };
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({
    status: mockSession.userId ? 'ready' : 'signed_out',
    userId: mockSession.userId,
    profile: null,
    error: false,
    refresh: jest.fn(),
  }),
}));

type Pending = { resolve(error: unknown): void };
const writes: Pending[] = [];
const mockDb = { rows: [] as { category_id: string; level: string }[], failRead: false, gate: null as Promise<void> | null };
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => {
          await mockDb.gate;
          return mockDb.failRead
            ? { data: null, error: { message: 'x' } }
            : { data: mockDb.rows, error: null };
        },
      }),
      upsert: () =>
        new Promise((resolve) => {
          writes.push({ resolve: (error) => resolve({ error }) });
        }),
    }),
  },
}));

beforeEach(async () => {
  writes.length = 0;
  mockDb.rows = [];
  mockDb.failRead = false;
  mockDb.gate = null;
  mockSession.userId = 'u1';
  await AsyncStorage.clear();
});

it('serialises concurrent signed-out writes even when reads resolve in reverse order', async () => {
  const get = AsyncStorage.getItem as jest.Mock;
  const real = get.getMockImplementation() as (k: string) => Promise<string | null>;
  // Each read sees the stored value at call time but resolves later the earlier it was issued.
  for (const delay of [60, 40, 20]) {
    get.mockImplementationOnce(async (k: string) => {
      const value = await real(k);
      await new Promise((r) => setTimeout(r, delay));
      return value;
    });
  }
  await Promise.all([
    setLevel(null, 'a', 'like'),
    setLevel(null, 'b', 'love'),
    setLevel(null, 'c', 'curious'),
  ]);
  expect(await getInterests(null)).toEqual({ a: 'like', b: 'love', c: 'curious' });
});

it('updates optimistically and reverts when the write fails', async () => {
  const { result } = await renderHook(() => useInterests());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    result.current.setLevel('a', 'like');
  });
  expect(result.current.interests).toEqual({ a: 'like' });
  await act(async () => {
    writes[0].resolve({ message: 'fail' });
  });
  expect(result.current.interests).toEqual({});
});

it('a late failure does not undo a later change to the same category', async () => {
  const { result } = await renderHook(() => useInterests());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    result.current.setLevel('a', 'like');
    result.current.setLevel('a', 'love');
  });
  await act(async () => {
    writes[1].resolve(null);
  });
  await act(async () => {
    writes[0].resolve({ message: 'fail' });
  });
  expect(result.current.interests).toEqual({ a: 'love' });
});

it('keeps the previous list and reports an error when a signed-in read fails', async () => {
  mockDb.rows = [{ category_id: 'a', level: 'like' }];
  const { result } = await renderHook(() => useInterests());
  await waitFor(() => expect(result.current.interests).toEqual({ a: 'like' }));
  expect(result.current.error).toBe(false);
  mockDb.failRead = true;
  const { mergeLocalIntoAccount } = jest.requireActual('../src/features/interests/store');
  await act(async () => {
    await mergeLocalIntoAccount('u1');
  });
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.interests).toEqual({ a: 'like' });
});

it('resets to loading when the user changes', async () => {
  mockSession.userId = null;
  await setLevel(null, 'z', 'like');
  const { result, rerender } = await renderHook(() => useInterests());
  await waitFor(() => expect(result.current.interests).toEqual({ z: 'like' }));
  mockSession.userId = 'u1';
  mockDb.rows = [{ category_id: 'a', level: 'love' }];
  let release!: () => void;
  mockDb.gate = new Promise<void>((r) => (release = r));
  await rerender({});
  expect(result.current.loading).toBe(true);
  expect(result.current.interests).toEqual({});
  await act(async () => {
    release();
  });
  await waitFor(() => expect(result.current.interests).toEqual({ a: 'love' }));
});
