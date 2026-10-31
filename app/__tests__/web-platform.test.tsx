import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Platform } from 'react-native';
import { initI18n } from '../src/i18n';

jest.setTimeout(60000);

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), canGoBack: () => false },
  useRouter: () => ({ replace: (...a: unknown[]) => mockReplace(...a) }),
  useLocalSearchParams: () => ({}),
}));
const mockSupabase = {
  auth: {
    signInWithOAuth: jest.fn(async (_o?: unknown): Promise<{ data: object; error: unknown }> => ({ data: {}, error: null })),
    exchangeCodeForSession: jest.fn(async (_c?: unknown): Promise<{ data: object; error: unknown }> => ({ data: {}, error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  },
  from: jest.fn(),
};
jest.mock('../src/lib/supabase', () => ({ supabase: mockSupabase }));

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const g = globalThis as unknown as Record<string, unknown>;
const realDocument = g.document;
let local: ReturnType<typeof memoryStorage>;
let session: ReturnType<typeof memoryStorage>;
let location: { pathname: string; search: string; origin: string };

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'web');
  local = memoryStorage();
  session = memoryStorage();
  location = { pathname: '/app/activites/abc', search: '', origin: 'https://habitues.example' };
  g.localStorage = local;
  g.sessionStorage = session;
  if (!g.window) g.window = g;
  (g.window as Record<string, unknown>).location = location;
  process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habitues.example';
  process.env.EXPO_PUBLIC_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=fr.habitues.app';
});
afterEach(() => {
  jest.restoreAllMocks();
  g.document = realDocument;
});

describe('session storage on the web', () => {
  it('keeps the session in localStorage', async () => {
    const { secureSessionStorage } = require('../src/lib/secureSessionStorage.web');
    await secureSessionStorage.setItem('sb-auth', '{"a":1}');
    expect(local.getItem('sb-auth')).toBe('{"a":1}');
    expect(await secureSessionStorage.getItem('sb-auth')).toBe('{"a":1}');
    expect(await secureSessionStorage.getItem('missing')).toBeNull();
  });

  it('signing out clears it', async () => {
    const { secureSessionStorage } = require('../src/lib/secureSessionStorage.web');
    await secureSessionStorage.setItem('sb-auth', '{"a":1}');
    await secureSessionStorage.setItem('sb-auth-code-verifier', 'v');
    const { signOut } = require('../src/features/account/auth');
    await signOut();
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(local.getItem('sb-auth')).toBeNull();
    expect(local.length).toBe(0);
  });
});

describe('Google on the web', () => {
  it('redirects through Supabase OAuth to the callback page and remembers the page', async () => {
    const { signInWithGoogle } = require('../src/features/account/auth');
    const res = await signInWithGoogle();
    expect(res).toEqual({ ok: true });
    expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://habitues.example/app/auth/callback' },
    });
    expect(session.getItem('auth.returnTo')).toBe('/activites/abc');
  });

  it('maps an OAuth failure to an error code', async () => {
    mockSupabase.auth.signInWithOAuth.mockResolvedValueOnce({ data: {}, error: { message: 'Failed to fetch' } });
    const { signInWithGoogle } = require('../src/features/account/auth');
    expect(await signInWithGoogle()).toEqual({ ok: false, error: 'network' });
  });

  it('the callback finishes the session and goes back to the remembered page', async () => {
    session.setItem('auth.returnTo', '/activites/abc');
    location.search = '?code=pkce-code';
    const Callback = require('../src/app/auth/callback.web').default;
    await render(<Callback />);
    await act(async () => {});
    expect(mockSupabase.auth.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
    expect(mockReplace).toHaveBeenCalledWith('/activites/abc');
    expect(session.getItem('auth.returnTo')).toBeNull();
  });

  it('refuses an off-site return path', () => {
    const { takeReturnPath, rememberReturnPath } = require('../src/features/account/oauthReturn');
    session.setItem('auth.returnTo', '//evil.example/x');
    expect(takeReturnPath()).toBe('/');
    session.setItem('auth.returnTo', 'https://evil.example');
    expect(takeReturnPath()).toBe('/');
    location.pathname = '/app/associations/z';
    rememberReturnPath();
    expect(takeReturnPath()).toBe('/associations/z');
  });

  it('redirects to the origin the page is served from, not the configured base (preview deployments)', async () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://production.example';
    location.origin = 'https://abc123.habitues.pages.dev';
    const { signInWithGoogle } = require('../src/features/account/auth');
    await signInWithGoogle();
    expect(mockSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://abc123.habitues.pages.dev/app/auth/callback' },
    });
  });

  it('the callback goes back to the remembered page when the exchange fails, and forgets it', async () => {
    session.setItem('auth.returnTo', '/activites/abc');
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { message: 'bad' } });
    location.search = '?code=x';
    const Callback = require('../src/app/auth/callback.web').default;
    await render(<Callback />);
    await act(async () => {});
    expect(mockReplace).toHaveBeenCalledWith('/activites/abc');
    expect(session.getItem('auth.returnTo')).toBeNull();
  });

  it('the callback without a code also goes back to the remembered page', async () => {
    session.setItem('auth.returnTo', '/associations/z');
    location.search = '';
    const Callback = require('../src/app/auth/callback.web').default;
    await render(<Callback />);
    await act(async () => {});
    expect(mockSupabase.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/associations/z');
  });

  it('the callback goes home when the exchange fails and nothing was remembered', async () => {
    mockSupabase.auth.exchangeCodeForSession.mockResolvedValueOnce({ data: {}, error: { message: 'bad' } });
    location.search = '?code=x';
    const Callback = require('../src/app/auth/callback.web').default;
    await render(<Callback />);
    await act(async () => {});
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('Turnstile on the web', () => {
  type Script = { src?: string; onload?: () => void; onerror?: () => void; async?: boolean };
  let script: Script;
  let turnstile: { render: jest.Mock; remove: jest.Mock };
  beforeEach(() => {
    script = {};
    turnstile = { render: jest.fn(() => 'wid'), remove: jest.fn() };
    g.document = {
      createElement: jest.fn(() => script),
      head: { appendChild: jest.fn() },
      querySelector: jest.fn(() => null),
    };
    delete (g.window as Record<string, unknown>).turnstile;
  });

  it('loads the Cloudflare script, renders the widget with the action and emits the token', async () => {
    const { Turnstile } = require('../src/features/account/Turnstile.web');
    const onToken = jest.fn();
    const onError = jest.fn();
    await render(<Turnstile siteKey="site" action="feedback" onToken={onToken} onError={onError} />);
    expect(script.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    (g.window as Record<string, unknown>).turnstile = turnstile;
    await act(async () => script.onload?.());
    expect(turnstile.render).toHaveBeenCalledTimes(1);
    const opts = (turnstile.render.mock.calls[0] as unknown[])[1] as Record<string, (t?: string) => void>;
    expect(opts).toMatchObject({ sitekey: 'site', action: 'feedback' });
    await act(async () => opts.callback('tok-1'));
    expect(onToken).toHaveBeenCalledWith('tok-1');
    await act(async () => opts['error-callback']());
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('yields an empty token without a site key and loads nothing', async () => {
    const { Turnstile } = require('../src/features/account/Turnstile.web');
    const onToken = jest.fn();
    await render(<Turnstile siteKey="" onToken={onToken} onError={jest.fn()} />);
    expect(onToken).toHaveBeenCalledWith('');
    expect((g.document as { createElement: jest.Mock }).createElement).not.toHaveBeenCalled();
  });

  it('reports an error when the script fails to load', async () => {
    const { Turnstile } = require('../src/features/account/Turnstile.web');
    const onError = jest.fn();
    await render(<Turnstile siteKey="site" onToken={jest.fn()} onError={onError} />);
    await act(async () => script.onerror?.());
    expect(onError).toHaveBeenCalled();
  });
});

describe('screens that are not on the web', () => {
  it("Explorer shows Disponible dans l'application with the Play Store link", async () => {
    const Explore = require('../src/app/(tabs)/index.web').default;
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    await render(<Explore />);
    expect(screen.getByText("Disponible dans l'application")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Télécharger l'application"));
    expect(open).toHaveBeenCalledWith('https://play.google.com/store/apps/details?id=fr.habitues.app');
  });

  it.each([
    ['../src/app/(tabs)/messages.web'],
    ['../src/app/discussions/[activityId].web'],
    ['../src/app/activites/new.web'],
    ['../src/app/collectifs/[id].web'],
    ['../src/app/admin/_layout.web'],
  ])('%s is the unavailable screen', async (path) => {
    const Screen = require(path).default;
    await render(<Screen />);
    expect(screen.getByText("Disponible dans l'application")).toBeTruthy();
  });
});

describe('notifications on the web', () => {
  it('make no call and never prompt', async () => {
    const Notifications = require('expo-notifications');
    const push = require('../src/features/notifications/registerPush.web');
    const categories = require('../src/features/notifications/categories.web');
    expect(await push.registerForPush()).toBe('unavailable');
    expect(await push.refreshPushRegistration()).toBe('unavailable');
    await push.askForPush();
    await push.unregisterThisDevice();
    await categories.setupNotificationCategories();
    const Responder = require('../src/features/notifications/NotificationResponder.web').NotificationResponder;
    await render(<Responder />);
    for (const fn of Object.values(Notifications)) {
      if (jest.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe('calendar and share on the web', () => {
  it('downloads habitues-<date>.ics as text/calendar', async () => {
    const created: { blob?: Blob; download?: string; href?: string; click: jest.Mock } = { click: jest.fn() };
    const anchor = {
      set href(v: string) {
        created.href = v;
      },
      set download(v: string) {
        created.download = v;
      },
      click: created.click,
      remove: jest.fn(),
    };
    g.document = {
      createElement: jest.fn(() => anchor),
      body: { appendChild: jest.fn() },
    };
    const url = g.URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
    url.createObjectURL = jest.fn((b: Blob) => {
      created.blob = b;
      return 'blob:x';
    });
    url.revokeObjectURL = jest.fn();
    const { addSessionToCalendar } = require('../src/features/activities/calendar.web');
    const res = await addSessionToCalendar(
      { id: 's1', startsAt: '2026-07-14T19:30:00+02:00', placeLabel: 'Café' },
      { id: 'act1', title: 'Jeux', durationMinutes: 90, timezone: 'Europe/Paris' },
    );
    expect(res).toBe('added');
    expect(created.download).toBe('habitues-2026-07-14.ics');
    expect(created.blob?.type).toContain('text/calendar');
    expect(created.click).toHaveBeenCalled();
  });

  it('copies the link when navigator.share is missing', async () => {
    const writeText = jest.fn(async () => {});
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true });
    const { shareActivity } = require('../src/features/activities/share.web');
    expect(await shareActivity('abc', 'Go')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Go sur Habitués : https://habitues.example/activites/go-abc');
  });

  it('uses navigator.share when it exists', async () => {
    const share = jest.fn(async () => {});
    Object.defineProperty(globalThis, 'navigator', { value: { share }, configurable: true });
    const { shareActivity } = require('../src/features/activities/share.web');
    expect(await shareActivity('abc', 'Go')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'Go sur Habitués : https://habitues.example/activites/go-abc' });
  });
});
