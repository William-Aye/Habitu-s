import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { SessionProvider, useSession } from '../src/features/account/useSession';
import { supabase } from '../src/lib/supabase';
import { clearOutbox } from '../src/features/chat/outbox';

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('../src/features/chat/outbox', () => ({ clearOutbox: jest.fn() }));

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

describe('offline start', () => {
  it('keeps loading with error when getSession returns an error, then recovers on retry', async () => {
    auth.getSession
      .mockResolvedValueOnce({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } })
      .mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    maybeSingle.mockResolvedValue({ data: ROW, error: null });
    const { result } = await renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.status).toBe('loading');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.error).toBe(false);
  });

  it('keeps loading with error when getSession throws, and retries on foreground after the backoff', async () => {
    auth.getSession.mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.status).toBe('loading');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30000);
    });
    expect(auth.getSession).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('loading');
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await act(async () => {
      appStateHandler?.('active');
    });
    await waitFor(() => expect(result.current.status).toBe('signed_out'));
  });

  it('a genuine empty session is still signed_out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const { result } = await renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('signed_out'));
  });

  it('refresh does not report signed_out when getSession fails', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null });
    maybeSingle.mockResolvedValue({ data: ROW, error: null });
    const { result } = await renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Failed to fetch' } });
    let st: unknown;
    await act(async () => {
      st = await result.current.refresh();
    });
    expect(st).toBe('loading');
    expect(result.current.status).toBe('ready');
  });

  it('ignores an INITIAL_SESSION event with no session (it can mean the refresh failed offline)', async () => {
    let cb!: (e: string, s: unknown) => void;
    auth.onAuthStateChange.mockImplementation((fn: typeof cb) => {
      cb = fn;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    auth.getSession.mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe(true));
    await act(async () => {
      cb('INITIAL_SESSION', null);
    });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      cb('SIGNED_OUT', null);
    });
    expect(result.current.status).toBe('signed_out');
  });

  it('clears the chat outbox on sign-out and when another account signs in, not on the first sign-in', async () => {
    let cb!: (e: string, s: unknown) => void;
    auth.onAuthStateChange.mockImplementation((fn: typeof cb) => {
      cb = fn;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });
    (clearOutbox as jest.Mock).mockResolvedValue(undefined);
    maybeSingle.mockResolvedValue({ data: ROW, error: null });
    await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      cb('SIGNED_IN', { user: { id: 'u1' } });
    });
    expect(clearOutbox).not.toHaveBeenCalled();
    await act(async () => {
      cb('SIGNED_IN', { user: { id: 'u2' } });
    });
    expect(clearOutbox).toHaveBeenCalledTimes(1);
    await act(async () => {
      cb('SIGNED_OUT', null);
    });
    expect(clearOutbox).toHaveBeenCalledTimes(2);
  });
});
