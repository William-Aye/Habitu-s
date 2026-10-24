import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NewActivity from '../src/app/activites/new';
import { CollectifEditForm } from '../src/features/collectifs/CollectifEditForm';
import { createActivity } from '../src/features/activities/api';
import { addCommunityAssociation, searchLinkableAssociations } from '../src/features/activities/associationDirectory';
import { createCollectif, myCollectifs, updateCollectif } from '../src/features/collectifs/api';
import { fetchCategories } from '../src/features/interests/categories';
import { hasPublicPlaceNearby } from '../src/features/safety/publicPlace';
import { initI18n } from '../src/i18n';
import type { CollectifPage } from '../src/features/activities/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('../src/features/activities/api', () => ({ createActivity: jest.fn() }));
jest.mock('../src/features/activities/associationDirectory', () => ({
  searchLinkableAssociations: jest.fn(),
  addCommunityAssociation: jest.fn(),
}));
jest.mock('../src/features/notifications/registerPush', () => ({ askForPush: jest.fn(async () => {}) }));
jest.mock('../src/features/activities/share', () => ({ shareActivity: jest.fn(async () => {}) }));
jest.mock('../src/features/safety/publicPlace', () => ({ hasPublicPlaceNearby: jest.fn() }));
jest.mock('../src/features/collectifs/api', () => ({
  createCollectif: jest.fn(),
  myCollectifs: jest.fn(),
  updateCollectif: jest.fn(),
}));
jest.mock('../src/features/interests/categories', () => ({
  ...jest.requireActual('../src/features/interests/categories'),
  fetchCategories: jest.fn(),
}));
jest.mock('../src/features/explore/api', () => ({
  searchTowns: jest.fn(async () => [{ label: 'Lyon (69001)', lon: 4.83, lat: 45.76 }]),
}));
jest.mock('../src/features/account/homeArea', () => ({ currentCommune: jest.fn(async () => 'denied') }));
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ status: 'ready', userId: 'u1', profile: null, error: false, refresh: jest.fn() }),
}));
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => jest.fn(async () => true) }));

jest.setTimeout(60000);

const MESSAGE = 'Ce texte contient un mot interdit.';
const next = () => screen.getByLabelText('Suivant');

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  (hasPublicPlaceNearby as jest.Mock).mockResolvedValue(true);
  (myCollectifs as jest.Mock).mockResolvedValue({ ok: true, collectifs: [] });
  (searchLinkableAssociations as jest.Mock).mockResolvedValue([]);
  (fetchCategories as jest.Mock).mockResolvedValue([
    { id: 'cat1', slug: 'jeux', nameFr: 'Jeux de société', nameEn: 'Board games', icon: 'dice-5', parentId: null },
  ]);
});

async function pickTown() {
  await fireEvent.press(screen.getByLabelText('Saisir une ville'));
  await fireEvent.changeText(screen.getByLabelText('Nom de la ville'), 'Lyon');
  await fireEvent.press(await screen.findByLabelText('Lyon (69001)'));
}

it('publishing an activity with a forbidden word shows the message and stays on the page', async () => {
  (createActivity as jest.Mock).mockResolvedValue({ ok: false, error: 'content_refused' });
  await render(<NewActivity />);
  await screen.findByText('Étape 1 sur 5');
  await fireEvent.press(next());
  await fireEvent.press(await screen.findByLabelText('Jeux de société'));
  await fireEvent.changeText(screen.getByLabelText('Titre'), 'Titre refusé');
  await fireEvent.press(next());
  await screen.findByText('Étape 3 sur 5');
  await pickTown();
  await fireEvent.changeText(screen.getByLabelText('Nom du lieu'), 'Café des Arts');
  await fireEvent.press(next());
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2030-05-14');
  await fireEvent.changeText(screen.getByLabelText('Heure'), '19:30');
  await fireEvent.press(next());
  await screen.findByText('Étape 5 sur 5');
  await fireEvent.press(screen.getByLabelText('Publier'));
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
  expect(screen.queryByText('Partagez-la avec vos amis')).toBeNull();
  expect(screen.getByLabelText('Publier').props.accessibilityState?.disabled).not.toBe(true);
});

it('adding a club with a forbidden word shows the message, not the generic error', async () => {
  (addCommunityAssociation as jest.Mock).mockResolvedValue({ ok: false, error: 'content_refused' });
  await render(<NewActivity />);
  await screen.findByText('Étape 1 sur 5');
  await fireEvent.press(screen.getByLabelText('Une association'));
  await fireEvent.press(screen.getByLabelText('Ajouter ce club'));
  await fireEvent.changeText(screen.getByLabelText("Nom du club ou de l'association"), 'Club refusé');
  await fireEvent.press(screen.getByLabelText("Ajouter à l'annuaire"));
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
  expect(screen.queryByText("Impossible d'ajouter ce club. Réessayez.")).toBeNull();
});

it('creating a collectif with a forbidden word shows the message', async () => {
  (createCollectif as jest.Mock).mockResolvedValue({ ok: false, error: 'content_refused' });
  await render(<NewActivity />);
  await screen.findByText('Étape 1 sur 5');
  await fireEvent.press(screen.getByLabelText('Un collectif'));
  await fireEvent.press(await screen.findByLabelText('Créer un collectif'));
  await fireEvent.changeText(screen.getByLabelText('Nom du collectif'), 'Collectif refusé');
  await pickTown();
  await fireEvent.press(screen.getByLabelText('Créer le collectif'));
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
});

it('editing a collectif with a forbidden word shows the message', async () => {
  (updateCollectif as jest.Mock).mockResolvedValue({ ok: false, error: 'content_refused' });
  const collectif = { id: 'c1', name: 'Les Joueurs', description: 'Des jeux', townLabel: 'Lyon' } as CollectifPage;
  await render(<CollectifEditForm collectif={collectif} onSaved={jest.fn()} onCancel={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Enregistrer'));
  await waitFor(() => expect(updateCollectif).toHaveBeenCalled());
  expect(await screen.findByText(MESSAGE)).toBeTruthy();
});
