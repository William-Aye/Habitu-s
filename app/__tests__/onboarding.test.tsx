import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import i18next from 'i18next';
import * as Location from 'expo-location';
import { renderRouter, screen } from 'expo-router/testing-library';
import { initI18n } from '../src/i18n';

const mockLocales: { tag: string } = { tag: 'fr-FR' };
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: mockLocales.tag }],
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockSession: { status: string; error: boolean; listeners: Set<() => void>; version: number } = {
  status: 'signed_out',
  error: false,
  listeners: new Set(),
  version: 0,
};
function mockSetStatus(status: string) {
  mockSession.status = status;
  mockSession.version += 1;
  mockSession.listeners.forEach((l) => l());
}
jest.mock('../src/features/account/useSession', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    React.useSyncExternalStore(
      (cb: () => void) => {
        mockSession.listeners.add(cb);
        return () => mockSession.listeners.delete(cb);
      },
      () => mockSession.version,
    );
    return {
    status: mockSession.status,
    userId: mockSession.status === 'ready' ? 'u1' : null,
    profile: null,
    error: mockSession.error,
    refresh: jest.fn(),
    };
  },
}));
jest.mock('../src/features/account/AccountGate', () => ({
  AccountGateProvider: ({ children }: { children: React.ReactNode }) => children,
  useRequireAccount: () => jest.fn(),
}));
jest.mock('../src/features/interests/categories', () => {
  const actual = jest.requireActual('../src/features/interests/categories');
  return { ...actual, fetchCategories: async () => [] };
});
jest.mock('../src/features/explore/api', () => ({
  ...jest.requireActual('../src/features/explore/api'),
  searchTowns: async () => [{ label: 'Lyon (69001)', lon: 4.835, lat: 45.758 }],
  searchExplore: jest.fn(async () => ({
    mode: 'browse',
    results: [],
    strongCount: 0,
    strongCount50km: 0,
    suggestRadiusKm: null,
    hasMore: false,
  })),
}));

jest.setTimeout(60000);

const realFetch = global.fetch;
beforeEach(async () => {
  mockLocales.tag = 'fr-FR';
  mockSession.status = 'signed_out';
  mockSession.error = false;
  await AsyncStorage.clear();
  await initI18n();
});
afterEach(() => {
  global.fetch = realFetch;
});

const WHERE = 'Où êtes-vous ?';

it('opens on the first-launch screen with no flag and no account', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText(WHERE)).toBeTruthy();
  expect(screen.getByText("Qu'est-ce qui vous plaît ?")).toBeTruthy();
});

it('opens on Explorer once onboarding is done', async () => {
  await AsyncStorage.setItem('onboarding.done', '1');
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(screen.queryByText(WHERE)).toBeNull();
});

it('never shows onboarding to a signed-in user', async () => {
  mockSession.status = 'ready';
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(screen.queryByText(WHERE)).toBeNull();
});

it('covers the app and does not show onboarding while the session is loading', async () => {
  mockSession.status = 'loading';
  await renderRouter('./src/app', { initialUrl: '/' });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
  });
  expect(screen.getByTestId('startup-cover')).toBeTruthy();
  expect(screen.queryByText(WHERE)).toBeNull();
});

it('shows the app, never onboarding, when the profile fetch keeps failing', async () => {
  mockSession.status = 'loading';
  mockSession.error = true;
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(screen.queryByTestId('startup-cover')).toBeNull();
  expect(screen.queryByText(WHERE)).toBeNull();
});

it('gives up waiting for the session after about 3 seconds and shows the app', async () => {
  mockSession.status = 'loading';
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(screen.getByTestId('startup-cover')).toBeTruthy();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3500);
  });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(screen.queryByTestId('startup-cover')).toBeNull();
  expect(screen.queryByText(WHERE)).toBeNull();
});

it('writes the onboarding flag once the session is ready', async () => {
  mockSession.status = 'ready';
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });
  expect(await AsyncStorage.getItem('onboarding.done')).toBe('1');
});

it('does not redirect when a signed-in user signs out in the same run', async () => {
  mockSetStatus('ready');
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  await act(async () => {
    mockSetStatus('signed_out');
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(screen.queryByText(WHERE)).toBeNull();
  expect(screen.getByText('Explorer')).toBeTruthy();
});

it('lifts the cover after 3 seconds when the flag read never resolves', async () => {
  const real = AsyncStorage.getItem;
  AsyncStorage.getItem = ((key: string) =>
    key === 'onboarding.done' ? new Promise(() => {}) : real(key)) as typeof real;
  try {
    await renderRouter('./src/app', { initialUrl: '/' });
    expect(screen.getByTestId('startup-cover')).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3500);
    });
    expect(screen.queryByTestId('startup-cover')).toBeNull();
    expect(screen.queryByText(WHERE)).toBeNull();
  } finally {
    AsyncStorage.getItem = real;
  }
});

it('warns without user data when the flag cannot be written', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const realSet = AsyncStorage.setItem;
  AsyncStorage.setItem = (async () => {
    throw new Error('disk full');
  }) as typeof realSet;
  try {
    mockSetStatus('ready');
    await renderRouter('./src/app', { initialUrl: '/' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(50);
    });
    expect(warn).toHaveBeenCalledWith('onboarding flag write failed');
  } finally {
    AsyncStorage.setItem = realSet;
    warn.mockRestore();
  }
});

it('does not redirect a first launch that opens a deep link', async () => {
  await renderRouter('./src/app', { initialUrl: '/associations/abc' });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(screen.queryByText(WHERE)).toBeNull();
});

it('offers the language choice only on an en-GB device with nothing stored', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  await screen.findByText(WHERE);
  expect(screen.queryByText('English')).toBeNull();
});

it('shows the language choice for an en-GB device and applies it', async () => {
  mockLocales.tag = 'en-GB';
  await renderRouter('./src/app', { initialUrl: '/' });
  await fireEvent.press(await screen.findByText('English'));
  await waitFor(() => expect(i18next.language).toBe('en'));
  expect(await AsyncStorage.getItem('app.language')).toBe('en');
});

it('disables "Commencer" until a town is chosen, then starts', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  const start = await screen.findByLabelText('Commencer');
  expect(start.props.accessibilityState?.disabled).toBe(true);
  await fireEvent.press(screen.getByLabelText('Saisir une ville'));
  const field = await screen.findByLabelText('Nom de la ville');
  await fireEvent.changeText(field, 'Lyon');
  await waitFor(() => expect(screen.getByLabelText('Nom de la ville').props.value).toBe('Lyon'));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  await fireEvent.press(await screen.findByLabelText('Lyon (69001)'));
  await waitFor(() =>
    expect(screen.getByLabelText('Commencer').props.accessibilityState?.disabled).toBe(false),
  );
  await fireEvent.press(screen.getByLabelText('Commencer'));
  expect(await screen.findByText('Mes activités')).toBeTruthy();
  expect(await AsyncStorage.getItem('onboarding.done')).toBe('1');
});

it('"Passer" sets the flag and shows Explorer', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText('Passer'));
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(await AsyncStorage.getItem('onboarding.done')).toBe('1');
});

it('GPS denied leaves the town search available', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  await renderRouter('./src/app', { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText('Utiliser ma position'));
  expect(await screen.findByText('Position refusée. Saisissez une ville.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Saisir une ville'));
  expect(await screen.findByLabelText('Nom de la ville')).toBeTruthy();
  expect(screen.getByLabelText('Passer')).toBeTruthy();
});

it('GPS granted stores the commune centre, not the position', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { longitude: 4.8512, latitude: 45.7533 },
  });
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => [
      { nom: 'Lyon', centre: { coordinates: [4.8467, 45.7485] }, codesPostaux: ['69001'] },
    ],
  })) as unknown as typeof fetch;
  await renderRouter('./src/app', { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText('Utiliser ma position'));
  expect(await screen.findByText('Lieu choisi : Lyon (69001)')).toBeTruthy();
  const v = JSON.parse((await AsyncStorage.getItem('explore.location')) as string);
  expect(v.label).toBe('Lyon (69001)');
  expect(Math.round(v.lon * 100) / 100).toBe(4.85);
  expect(Math.round(v.lat * 100) / 100).toBe(45.75);
  expect(v.lon).toBe(4.8467);
  expect(screen.getByLabelText('Commencer').props.accessibilityState?.disabled).toBe(false);
});

it('GPS whose commune cannot be found falls back to the town search', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
    coords: { longitude: 4.85, latitude: 45.75 },
  });
  global.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  await renderRouter('./src/app', { initialUrl: '/' });
  await fireEvent.press(await screen.findByLabelText('Utiliser ma position'));
  expect(await screen.findByText('Position refusée. Saisissez une ville.')).toBeTruthy();
  expect(await AsyncStorage.getItem('explore.location')).toBeNull();
});
