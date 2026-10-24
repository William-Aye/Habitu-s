import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform, Pressable, Text } from 'react-native';
import { initI18n } from '../src/i18n';
import ActivityScreen from '../src/app/activites/[id]';
import { AccountGateProvider, useRequireAccount } from '../src/features/account/AccountGate';
import * as auth from '../src/features/account/auth';
import { getActivity, joinActivity, setAttendance } from '../src/features/activities/api';
import type { ActivityPage, SessionInfo } from '../src/features/activities/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'act1' }),
  Link: 'Link',
}));
// Platform files are resolved by Metro on the web; here the web modules are wired in by hand.
jest.mock('../src/features/explore/components/TownMap', () => require('../src/features/explore/components/TownMap.web'));
jest.mock('../src/features/activities/calendar', () => require('../src/features/activities/calendar.web'));
jest.mock('../src/features/activities/share', () => require('../src/features/activities/share.web'));
jest.mock('../src/features/notifications/registerPush', () => require('../src/features/notifications/registerPush.web'));
jest.mock('../src/features/account/Turnstile', () => require('../src/features/account/Turnstile.web'));
jest.mock('../src/features/activities/api', () => ({
  getActivity: jest.fn(),
  joinActivity: jest.fn(),
  leaveActivity: jest.fn(),
  setAttendance: jest.fn(),
}));
let mockGate: (() => Promise<boolean>) | null = null;
jest.mock('../src/features/account/AccountGate', () => {
  const actual = jest.requireActual('../src/features/account/AccountGate');
  return { ...actual, useRequireAccount: () => (mockGate ?? actual.useRequireAccount()) };
});
jest.mock('../src/features/account/auth');
jest.mock('../src/features/explore/useExploreLocation', () => ({
  useExploreLocation: () => ({ location: null, status: 'needed', requestGps: jest.fn(), setTown: jest.fn() }),
}));
jest.mock('../src/features/account/useSession', () => {
  const React = require('react');
  const store = { value: null as unknown, listeners: new Set<() => void>() };
  return {
    __store: store,
    useSession: () =>
      React.useSyncExternalStore(
        (cb: () => void) => {
          store.listeners.add(cb);
          return () => store.listeners.delete(cb);
        },
        () => store.value,
      ),
  };
});

jest.setTimeout(60000);

const store = (jest.requireMock('../src/features/account/useSession') as {
  __store: { value: unknown; listeners: Set<() => void> };
}).__store;
const g = globalThis as unknown as Record<string, unknown>;
const mocked = auth as jest.Mocked<typeof auth>;
const IN_3_DAYS = new Date(Date.now() + 3 * 86_400_000).toISOString();

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1', startsAt: IN_3_DAYS, placeLabel: 'Café des Arts', isDiscovery: false, status: 'scheduled',
    confirmedCount: 4, isFull: false, myAttendance: null, ...over,
  };
}
function activity(over: Partial<ActivityPage> = {}): ActivityPage {
  return {
    id: 'act1', title: 'Jeux de société', description: 'Une soirée conviviale',
    category: { id: 'c', slug: 'jeux', nameFr: 'Jeux', nameEn: 'Games', icon: 'dice' }, tags: [],
    organiser: { firstName: 'Olivier', photoUrl: null }, organisedBy: null, placeLabel: 'Café des Arts',
    lon: 4.85, lat: 45.77, recurrence: { kind: 'weekly' }, startDate: '2026-10-20', startTime: '19:00:00',
    durationMinutes: 120, timezone: 'Europe/Paris', maxSize: null, newcomerFriendly: true,
    approvalMode: 'open', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null, isOrganiser: false,
    myStatus: 'none', nextSessions: [session()], ...over,
  };
}

async function setSession(value: unknown) {
  await act(async () => {
    store.value = value;
    store.listeners.forEach((l) => l());
  });
}
const signedOut = { status: 'signed_out', userId: null, profile: null, refresh: jest.fn(async () => {}) };

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.resetAllMocks();
  mockGate = null;
  jest.replaceProperty(Platform, 'OS', 'web');
  delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  if (!g.window) g.window = g;
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('renders the activity for a visitor, with a map link instead of a map, then confirms attendance after sign-in', async () => {
  (getActivity as jest.Mock).mockResolvedValue({ ok: true, activity: activity() });
  (joinActivity as jest.Mock).mockResolvedValue({ ok: true, status: 'member' });
  (setAttendance as jest.Mock).mockResolvedValue({ ok: true });
  await setSession(signedOut);
  // The sign-up sheet ends with the visitor signed in: the gate resolves true.
  mockGate = jest.fn(async () => true);
  await render(<ActivityScreen />);
  await screen.findByText('Jeux de société');
  expect(screen.getByText('4 confirmés')).toBeTruthy();
  expect(screen.getByLabelText('Voir sur la carte')).toBeTruthy();
  expect(screen.queryByText('Je serai là')).toBeNull();

  (getActivity as jest.Mock).mockResolvedValue({ ok: true, activity: activity({ myStatus: 'member' }) });
  await fireEvent.press(screen.getByLabelText('Rejoindre'));
  await waitFor(() => expect(joinActivity).toHaveBeenCalledWith('act1'));
  const imThere = await screen.findByText('Je serai là');
  expect(setAttendance).not.toHaveBeenCalled();
  await fireEvent.press(imThere);
  await waitFor(() => expect(setAttendance).toHaveBeenCalledWith('s1', 'confirmed', 0));
});

describe('sign-up sheet on the web', () => {
  it('shows the web Turnstile, which emits a token that reaches the email code request', async () => {
    type Script = { src?: string; onload?: () => void; onerror?: () => void };
    const script: Script = {};
    const turnstile = { render: jest.fn(() => 'wid'), remove: jest.fn() };
    g.document = {
      createElement: jest.fn(() => script),
      head: { appendChild: jest.fn() },
      querySelector: jest.fn(() => null),
    };
    delete (g.window as Record<string, unknown>).turnstile;
    process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'site-key';
    mocked.sendEmailCode.mockResolvedValue({ ok: true });
    await setSession(signedOut);

    function Harness() {
      const requireAccount = useRequireAccount();
      return (
        <Pressable accessibilityRole="button" onPress={() => void requireAccount('join')}>
          <Text>ouvrir</Text>
        </Pressable>
      );
    }
    await render(
      <AccountGateProvider>
        <Harness />
      </AccountGateProvider>,
    );
    await fireEvent.press(screen.getByText('ouvrir'));
    await screen.findByText('Créez votre compte en 1 minute');
    expect(script.src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    (g.window as Record<string, unknown>).turnstile = turnstile;
    await act(async () => script.onload?.());
    const opts = (turnstile.render.mock.calls[0] as unknown[])[1] as Record<string, (t?: string) => void>;
    await act(async () => opts.callback('web-token'));

    await fireEvent.changeText(screen.getByLabelText('Adresse e-mail'), 'ana@exemple.fr');
    await fireEvent.press(screen.getByText('Recevoir un code par e-mail'));
    await screen.findByText('Entrez le code reçu à ana@exemple.fr');
    expect(mocked.sendEmailCode).toHaveBeenCalledWith('ana@exemple.fr', 'web-token');
  });
});

