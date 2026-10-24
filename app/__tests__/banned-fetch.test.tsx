import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { initI18n } from '../src/i18n';
import { isBannedSignal, setBannedSignal } from '../src/lib/bannedSignal';
import { verifyEmailCode } from '../src/features/account/auth';
import { SuspendedNotice } from '../src/features/account/SuspendedNotice';
import { SessionProvider, useSession } from '../src/features/account/useSession';
import { supabase } from '../src/lib/supabase';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/features/chat/outbox', () => ({ clearOutbox: jest.fn(async () => {}), flush: jest.fn() }));
jest.mock('../src/features/notifications/registerPush', () => ({ unregisterThisDevice: jest.fn(async () => {}) }));
// The real client: only the network underneath it is faked.
jest.mock('../src/lib/supabase', () => {
  const actual = jest.requireActual('../src/lib/supabase');
  return { supabase: actual.createSupabaseClient('http://127.0.0.1:55321', 'test-key') };
});

const BAN_BODY = { code: 403, error_code: 'user_banned', msg: 'User is banned' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const calls: string[] = [];
let respond: (url: string) => Response;
const jwt = (exp: number) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp, aud: 'authenticated', role: 'authenticated' })}.sig`;
};

beforeAll(async () => {
  await initI18n();
});
beforeEach(async () => {
  calls.length = 0;
  setBannedSignal(false);
  respond = () => json(200, {});
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(typeof input === 'string' ? input : (input as { url?: string }).url ?? input);
    calls.push(url);
    return respond(url);
  }) as never;
  await supabase.auth.signOut({ scope: 'local' });
  setBannedSignal(false);
});

describe('ban detected at the fetch level', () => {
  it('flags a 403 user_banned on the token endpoint and leaves the body for the SDK', async () => {
    respond = () => json(403, BAN_BODY);
    const r = await supabase.auth.refreshSession({ refresh_token: 'r' });
    expect(calls.some((u) => u.includes('/auth/v1/token'))).toBe(true);
    expect(isBannedSignal()).toBe(true);
    expect(r.error).toBeTruthy(); // the SDK still read its own copy of the response
    expect(r.error?.message).toMatch(/banned/i);
  });

  it('ignores other 403s and other endpoints', async () => {
    respond = () => json(403, { code: 403, error_code: 'not_admin', msg: 'nope' });
    await supabase.auth.refreshSession({ refresh_token: 'r' });
    expect(isBannedSignal()).toBe(false);
    respond = (url) => (url.includes('/rest/v1/') ? json(403, BAN_BODY) : json(200, {}));
    await fetch('http://127.0.0.1:55321/rest/v1/profiles'); // not wrapped: sanity check of the fake
    expect(isBannedSignal()).toBe(false);
    await supabase.from('profiles').select('id');
    expect(isBannedSignal()).toBe(false);
  });

  it('a refresh of a stored session refused as banned shows the full-screen notice', async () => {
    // The SDK refreshes the stored session and the server says the account is banned.
    respond = () => json(403, BAN_BODY);
    const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider>{children}</SessionProvider>;
    const hook = await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      await supabase.auth.refreshSession({ refresh_token: 'r' });
    });
    await waitFor(() => expect(hook.result.current.banned).toBe(true));
    expect(hook.result.current.status).toBe('signed_out');

    await render(<SuspendedNotice />, { wrapper });
    expect(await screen.findByText(/Votre compte a été suspendu pour non-respect/)).toBeTruthy();
    expect(screen.getByLabelText('Compris')).toBeTruthy();
  });

  it('the sign-in path flags the ban too, so the notice appears there', async () => {
    respond = () => json(403, BAN_BODY);
    const r = await verifyEmailCode('a@b.fr', '123456');
    expect(r).toEqual({ ok: false, error: 'banned' });
    expect(isBannedSignal()).toBe(true);
  });

  it('a good session clears the flag', async () => {
    setBannedSignal(true);
    respond = () =>
      json(200, {
        access_token: jwt(Math.floor(Date.now() / 1000) + 3600),
        refresh_token: 'r2',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'u1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      });
    const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider>{children}</SessionProvider>;
    const hook = await renderHook(() => useSession(), { wrapper });
    await act(async () => {
      await supabase.auth.refreshSession({ refresh_token: 'r' });
    });
    await waitFor(() => expect(hook.result.current.banned).toBe(false));
  });
});
