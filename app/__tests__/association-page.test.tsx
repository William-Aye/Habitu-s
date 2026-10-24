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

jest.mock('../src/features/claims/ClaimForm', () => {
  const { Text } = require('react-native');
  return { ClaimForm: ({ associationId }: { associationId: string }) => <Text>{`claim-form ${associationId}`}</Text> };
});

const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({
  useRequireAccount: () => mockGate,
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
  mockGate.mockReset();
  mockGate.mockResolvedValue(false);
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

it('catches a failed Linking.openURL', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  const spy = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
  try {
    await show(assoc({ email: 'club@exemple.fr', canWait: false }));
    await fireEvent.press(screen.getByText('club@exemple.fr'));
    expect(spy).toHaveBeenCalledWith('mailto:club@exemple.fr');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
    spy.mockRestore();
  }
});

it('keeps the waiting view and shows an error when cancelling fails', async () => {
  mockRemove.mockRejectedValue(new Error('network'));
  await show(assoc({ isWaiting: true }));
  await fireEvent.press(screen.getByText('Annuler'));
  expect(await screen.findByText("Impossible d'enregistrer votre demande. Réessayez.")).toBeTruthy();
  expect(screen.getByText('Nous vous préviendrons')).toBeTruthy();
  expect(screen.queryByText(WAIT)).toBeNull();
});

it('shows the waiter error when registering fails', async () => {
  mockAdd.mockRejectedValue(new Error('network'));
  await show(assoc());
  await fireEvent.press(screen.getByText(WAIT));
  expect(await screen.findByText("Impossible d'enregistrer votre demande. Réessayez.")).toBeTruthy();
  expect(screen.getByText(WAIT)).toBeTruthy();
});

it('shows the waiter button for a contactless unclaimed listing', async () => {
  await show(assoc());
  expect(screen.getByText(WAIT)).toBeTruthy();
});

it('opens the gate with the wait reason when signed out, with no insert', async () => {
  mockAdd.mockResolvedValue('signed_out');
  await show(assoc());
  await fireEvent.press(screen.getByText(WAIT));
  expect(await screen.findByText('Connectez-vous pour être prévenu(e).')).toBeTruthy();
  expect(mockGate).toHaveBeenCalledWith('wait');
  expect(mockAdd).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Nous vous préviendrons')).toBeNull();
});

it('retries the waiter registration once the account is created', async () => {
  mockAdd.mockResolvedValueOnce('signed_out').mockResolvedValueOnce('added');
  mockGate.mockResolvedValue(true);
  await show(assoc());
  await fireEvent.press(screen.getByText(WAIT));
  expect(await screen.findByText('Nous vous préviendrons')).toBeTruthy();
  expect(mockGate).toHaveBeenCalledWith('wait');
  expect(mockAdd).toHaveBeenCalledTimes(2);
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

it('labels the claim and report controls for screen readers; pressing the claim opens the claim form', async () => {
  await show(assoc());
  const claim = screen.getByLabelText("C'est mon association");
  const report = screen.getByLabelText('Signaler une erreur / Retirer cette fiche');
  expect(claim.props.accessibilityRole).toBe('button');
  expect(report.props.accessibilityRole).toBe('link');
  await fireEvent.press(claim);
  expect(screen.getByText('claim-form a1')).toBeTruthy();
  expect(screen.queryByText('Bientôt disponible')).toBeNull();
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
