import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { AssociationDetail } from '../src/features/explore/types';
import { initI18n } from '../src/i18n';
import Association from '../src/app/associations/[id]';
import { addWaiter, getAssociation, removeWaiter } from '../src/features/explore/api';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'a1' }),
}));
jest.mock('../src/features/explore/api', () => ({
  getAssociation: jest.fn(),
  addWaiter: jest.fn(),
  removeWaiter: jest.fn(),
}));

const mockGet = getAssociation as jest.Mock;
const mockAdd = addWaiter as jest.Mock;
const mockRemove = removeWaiter as jest.Mock;

const WAIT = 'Me prévenir quand ce club arrive';

function assoc(over: Partial<AssociationDetail> = {}): AssociationDetail {
  return {
    id: 'a1', name: 'Club des Lilas', purpose: 'Faire du sport ensemble', city: 'Lyon',
    postcode: '69001', lon: 4.8, lat: 45.7, website: null, phone: null, email: null,
    openingHours: null, source: 'rna', verified: false, claimed: false, sourceLabel: null,
    attributionKeys: [], tags: [], activities: [], canWait: true, isWaiting: false, ...over,
  };
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue(assoc());
  mockAdd.mockResolvedValue('added');
  mockRemove.mockResolvedValue(undefined);
});

async function show(a: AssociationDetail | null) {
  mockGet.mockResolvedValue(a);
  await render(<Association />);
  await screen.findByText(a ? a.name : "Cette fiche n'est plus disponible");
}

it('labels a community listing', async () => {
  await show(assoc({ source: 'community', sourceLabel: 'community' }));
  expect(screen.getByText('Ajouté par la communauté')).toBeTruthy();
});

it('labels a low-confidence listing as non vérifié', async () => {
  await show(assoc({ sourceLabel: 'unverified' }));
  expect(screen.getByText('non vérifié')).toBeTruthy();
});

it('shows the verified label', async () => {
  await show(assoc({ verified: true }));
  expect(screen.getByText('Association vérifiée')).toBeTruthy();
});

it('hides the waiter button when the listing cannot be waited for', async () => {
  await show(assoc({ phone: '0102030405', canWait: false }));
  expect(screen.queryByText(WAIT)).toBeNull();
});

it('opens the phone with Linking', async () => {
  const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  await show(assoc({ phone: '0102030405', canWait: false }));
  await fireEvent.press(screen.getByText('0102030405'));
  expect(spy).toHaveBeenCalledWith('tel:0102030405');
});

it('shows the waiter button for a contactless unclaimed listing', async () => {
  await show(assoc());
  expect(screen.getByText(WAIT)).toBeTruthy();
});

it('asks to sign in when signed out, with no insert', async () => {
  mockAdd.mockResolvedValue('signed_out');
  await show(assoc());
  await fireEvent.press(screen.getByText(WAIT));
  expect(await screen.findByText('Connectez-vous pour être prévenu(e).')).toBeTruthy();
  expect(screen.queryByText('Nous vous préviendrons')).toBeNull();
});

it('registers the waiter when signed in, and can cancel', async () => {
  await show(assoc());
  await fireEvent.press(screen.getByText(WAIT));
  expect(await screen.findByText('Nous vous préviendrons')).toBeTruthy();
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(mockAdd).toHaveBeenCalledWith('a1');
  await fireEvent.press(screen.getByText('Annuler'));
  expect(mockRemove).toHaveBeenCalledWith('a1');
  expect(await screen.findByText(WAIT)).toBeTruthy();
});

it('shows coming-soon controls labelled for screen readers', async () => {
  await show(assoc());
  const claim = screen.getByLabelText("C'est mon association");
  const report = screen.getByLabelText('Signaler une erreur / Retirer cette fiche');
  expect(claim.props.accessibilityRole).toBe('button');
  expect(report.props.accessibilityRole).toBe('link');
  await fireEvent.press(claim);
  expect(screen.getByText('Bientôt disponible')).toBeTruthy();
});

it('renders both attribution lines', async () => {
  await show(assoc({ attributionKeys: ['rna', 'osm'] }));
  expect(
    screen.getByText('Source : Répertoire national des associations (Licence Ouverte / Etalab 2.0)'),
  ).toBeTruthy();
  expect(screen.getByText("© les contributeurs d'OpenStreetMap (ODbL)")).toBeTruthy();
});

it('shows a message for a missing listing', async () => {
  await show(null);
  expect(screen.getByText("Cette fiche n'est plus disponible")).toBeTruthy();
});

it('renders no address text, only the town', async () => {
  await show(assoc());
  expect(screen.getByText('Lyon (69001)')).toBeTruthy();
  expect(screen.queryByText(/\d+ rue/)).toBeNull();
});

it('lists activities and links to them', async () => {
  const { router } = require('expo-router');
  await show(assoc({ activities: [{ id: 'x1', title: 'Yoga' }] }));
  expect(screen.getByText('Activités organisées')).toBeTruthy();
  await fireEvent.press(screen.getByText('Yoga'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'x1', title: 'Yoga' } });
});
