import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { SessionProvider, useSession } from '../src/features/account/useSession';
import { supabase } from '../src/lib/supabase';

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const from = supabase.from as unknown as jest.Mock;
let maybeSingle: jest.Mock;
let appStateHandler: ((s: string) => void) | undefined;

const ROW = { first_name: 'Ana', age_confirmed: true, language: 'fr', photo_url: null, bio: null };
const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider>{children}</SessionProvider>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appStateHandler = h;
    return { remove: jest.fn() };
  }) as never);
  maybeSingle = jest.fn();
  from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
});
afterEach(() => {
  jest.useRealTimers();
});

it('retries a failed profile fetch with backoff and ends ready', async () => {
  maybeSingle
    .mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } })
    .mockResolvedValueOnce({ data: ROW, error: null });
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.status).toBe('loading');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2000);
  });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.error).toBe(false);
  expect(maybeSingle).toHaveBeenCalledTimes(2);
});

it('stops retrying after the last delay', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(true));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2000 + 5000 + 15000 + 60000);
  });
  expect(maybeSingle).toHaveBeenCalledTimes(4);
  expect(result.current.status).toBe('loading');
});

it('refresh loads the profile once and reports the settled status', async () => {
  maybeSingle.mockResolvedValue({ data: ROW, error: null });
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  maybeSingle.mockClear();
  let status: unknown;
  await act(async () => {
    status = await result.current.refresh();
  });
  expect(status).toBe('ready');
  expect(maybeSingle).toHaveBeenCalledTimes(1);
});

it('refresh reports loading when the profile cannot be fetched', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(true));
  let status: unknown;
  await act(async () => {
    status = await result.current.refresh();
  });
  expect(status).toBe('loading');
});

it('retries once more when the app returns to the foreground after the backoff is exhausted', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } });
  const { result } = await renderHook(() => useSession(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(true));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(30000);
  });
  expect(maybeSingle).toHaveBeenCalledTimes(4);
  maybeSingle.mockResolvedValue({ data: ROW, error: null });
  await act(async () => {
    appStateHandler?.('active');
  });
  await waitFor(() => expect(result.current.status).toBe('ready'));
});
