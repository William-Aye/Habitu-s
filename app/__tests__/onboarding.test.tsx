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

const mockSession: { status: string } = { status: 'signed_out' };
jest.mock('../src/features/account/useSession', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({
    status: mockSession.status,
    userId: mockSession.status === 'ready' ? 'u1' : null,
    profile: null,
    error: false,
    refresh: jest.fn(),
  }),
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

it('does not flash onboarding while the session is loading', async () => {
  mockSession.status = 'loading';
  await renderRouter('./src/app', { initialUrl: '/' });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(200);
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
