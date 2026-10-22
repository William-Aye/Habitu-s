import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  completeProfile,
  mapAuthError,
  sendEmailCode,
  signInWithGoogle,
  signOut,
  verifyEmailCode,
} from '../src/features/account/auth';
import { resolveHomeArea } from '../src/features/account/homeArea';
import { supabase } from '../src/lib/supabase';

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithIdToken: jest.fn(),
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const gsi = GoogleSignin as unknown as Record<string, jest.Mock>;
const from = supabase.from as unknown as jest.Mock;

let update: jest.Mock;
let eq: jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  gsi.signOut.mockResolvedValue(null);
  auth.signOut.mockResolvedValue({ error: null });
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  eq = jest.fn().mockResolvedValue({ error: null });
  update = jest.fn(() => ({ eq }));
  from.mockReturnValue({ update });
});

describe('error mapping', () => {
  it('maps Supabase errors', () => {
    expect(mapAuthError({ status: 429, message: 'x' })).toBe('rate_limited');
    expect(mapAuthError({ message: 'captcha verification process failed' })).toBe('captcha');
    expect(mapAuthError({ message: 'Token has expired or is invalid' })).toBe('expired_code');
    expect(mapAuthError({ message: 'Invalid token' })).toBe('invalid_code');
    expect(
      mapAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }),
    ).toBe('network');
    expect(mapAuthError(new TypeError('Network request failed'))).toBe('network');
    expect(mapAuthError({ message: 'boom' })).toBe('unknown');
  });

  it('sendEmailCode sends with the captcha token and maps errors', async () => {
    auth.signInWithOtp.mockResolvedValueOnce({ error: null });
    expect(await sendEmailCode('a@b.fr', 'tok')).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.fr',
      options: { shouldCreateUser: true, captchaToken: 'tok' },
    });
    auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 429, message: 'rate' } });
    expect(await sendEmailCode('a@b.fr', 'tok')).toEqual({ ok: false, error: 'rate_limited' });
    auth.signInWithOtp.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await sendEmailCode('a@b.fr', 'tok')).toEqual({ ok: false, error: 'network' });
  });

  it('verifyEmailCode maps invalid and expired codes', async () => {
    auth.verifyOtp.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } });
    expect(await verifyEmailCode('a@b.fr', '123456')).toEqual({ ok: false, error: 'expired_code' });
    auth.verifyOtp.mockResolvedValueOnce({ error: { message: 'Invalid token' } });
    expect(await verifyEmailCode('a@b.fr', '000000')).toEqual({ ok: false, error: 'invalid_code' });
    auth.verifyOtp.mockResolvedValueOnce({ error: null });
    expect(await verifyEmailCode('a@b.fr', '123456')).toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenLastCalledWith({
      email: 'a@b.fr',
      token: '123456',
      type: 'email',
    });
  });
});

describe('signInWithGoogle', () => {
  it('exchanges the id token', async () => {
    gsi.signIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'idt', user: { givenName: 'Ana' } },
    });
    auth.signInWithIdToken.mockResolvedValue({ error: null });
    expect(await signInWithGoogle()).toEqual({ ok: true, givenName: 'Ana' });
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'idt' });
  });

  it('maps cancellation, from a response or a thrown code', async () => {
    gsi.signIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'cancelled' });
    gsi.signIn.mockRejectedValueOnce({ code: 'SIGN_IN_CANCELLED' });
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'cancelled' });
    gsi.signIn.mockRejectedValueOnce(new Error('x'));
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'unknown' });
  });

  it('never reports a code error for a Google failure', async () => {
    gsi.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'idt', user: {} } });
    auth.signInWithIdToken.mockResolvedValue({ error: { message: 'Invalid token' } });
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'unknown' });
    auth.signInWithIdToken.mockResolvedValue({ error: { message: 'Token has expired' } });
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'unknown' });
    auth.signInWithIdToken.mockResolvedValue({ error: { status: 429, message: 'rate' } });
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('maps a Supabase failure', async () => {
    gsi.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'idt', user: {} } });
    auth.signInWithIdToken.mockResolvedValue({
      error: { message: 'Failed to fetch', name: 'AuthRetryableFetchError' },
    });
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'network' });
  });
});

describe('completeProfile', () => {
  const base = { ageConfirmed: true as const, language: 'fr' as const };

  it('rejects an empty, blank or too long first name', async () => {
    expect(await completeProfile({ ...base, firstName: '' })).toEqual({
      ok: false,
      error: 'first_name',
    });
    expect(await completeProfile({ ...base, firstName: '   ' })).toEqual({
      ok: false,
      error: 'first_name',
    });
    expect(await completeProfile({ ...base, firstName: 'a'.repeat(41) })).toEqual({
      ok: false,
      error: 'first_name',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an unconfirmed age', async () => {
    const r = await completeProfile({
      firstName: 'Ana',
      ageConfirmed: false as unknown as true,
      language: 'fr',
    });
    expect(r).toEqual({ ok: false, error: 'age' });
    expect(update).not.toHaveBeenCalled();
  });

  it('trims and updates the profile', async () => {
    expect(await completeProfile({ ...base, firstName: '  Ana ', language: 'en' })).toEqual({
      ok: true,
    });
    expect(from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ first_name: 'Ana', age_confirmed: true, language: 'en' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('sends the home area as an EWKT point', async () => {
    await completeProfile({
      ...base,
      firstName: 'Ana',
      homeArea: { lon: 4.83, lat: 45.76, label: 'Lyon' },
    });
    expect(update).toHaveBeenCalledWith({
      first_name: 'Ana',
      age_confirmed: true,
      language: 'fr',
      home_area: 'SRID=4326;POINT(4.83 45.76)',
      home_area_label: 'Lyon',
    });
  });

  it('never reports a code error for a profile failure', async () => {
    eq.mockResolvedValueOnce({ error: { message: 'invalid input syntax for type geography' } });
    expect(await completeProfile({ ...base, firstName: 'Ana' })).toEqual({
      ok: false,
      error: 'unknown',
    });
    eq.mockResolvedValueOnce({ error: { message: 'captcha failed' } });
    expect(await completeProfile({ ...base, firstName: 'Ana' })).toEqual({
      ok: false,
      error: 'unknown',
    });
  });

  it('maps a database failure and a missing session', async () => {
    eq.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    expect(await completeProfile({ ...base, firstName: 'Ana' })).toEqual({
      ok: false,
      error: 'network',
    });
    auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    expect(await completeProfile({ ...base, firstName: 'Ana' })).toEqual({
      ok: false,
      error: 'unknown',
    });
  });
});

describe('signOut', () => {
  it('swallows a Google error and still signs out of Supabase', async () => {
    gsi.signOut.mockRejectedValueOnce(new Error('google down'));
    await expect(signOut()).resolves.toBeUndefined();
    expect(auth.signOut).toHaveBeenCalled();
  });
});

describe('resolveHomeArea', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('uses a chosen town as is', async () => {
    expect(await resolveHomeArea({ label: 'Lyon', lon: 4.8, lat: 45.7, source: 'town' })).toEqual({
      label: 'Lyon',
      lon: 4.8,
      lat: 45.7,
    });
  });

  it('turns a GPS position into the commune centre', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [{ nom: 'Villeurbanne', centre: { coordinates: [4.88, 45.77] } }],
    })) as unknown as typeof fetch;
    expect(await resolveHomeArea({ label: 'x', lon: 4.87, lat: 45.78, source: 'gps' })).toEqual({
      label: 'Villeurbanne',
      lon: 4.88,
      lat: 45.77,
    });
  });

  it('gives up on the commune lookup after 10 seconds', async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ) as unknown as typeof fetch;
      const pending = resolveHomeArea({ label: 'x', lon: 1, lat: 2, source: 'gps' });
      await jest.advanceTimersByTimeAsync(10500);
      expect(await pending).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null when the commune cannot be found', async () => {
    global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await resolveHomeArea({ label: 'x', lon: 1, lat: 2, source: 'gps' })).toBeNull();
    expect(await resolveHomeArea(null)).toBeNull();
  });
});
