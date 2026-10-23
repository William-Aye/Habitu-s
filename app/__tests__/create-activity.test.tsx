import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import NewActivity from '../src/app/activites/new';
import { createActivity } from '../src/features/activities/api';
import { addCommunityAssociation, searchLinkableAssociations } from '../src/features/activities/associationDirectory';
import { shareActivity } from '../src/features/activities/share';
import { createCollectif, myCollectifs } from '../src/features/collectifs/api';
import { fetchCategories } from '../src/features/interests/categories';
import { initI18n } from '../src/i18n';

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
jest.mock('../src/features/activities/share', () => ({ shareActivity: jest.fn(async () => {}) }));
jest.mock('../src/features/collectifs/api', () => ({ createCollectif: jest.fn(), myCollectifs: jest.fn() }));
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
const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));

jest.setTimeout(60000);

const mockCreate = createActivity as jest.Mock;
const mockCollectifs = myCollectifs as jest.Mock;
const mockCreateCollectif = createCollectif as jest.Mock;
const mockCategories = fetchCategories as jest.Mock;
const mockSearchAssoc = searchLinkableAssociations as jest.Mock;
const mockAddClub = addCommunityAssociation as jest.Mock;

const HOME_TIP =
  "Ne vous donnez pas rendez-vous chez vous : le groupe saurait où vous habitez. Choisissez un lieu public (café, parc, salle, local d'association).";

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockResolvedValue(true);
  mockCollectifs.mockResolvedValue({ ok: true, collectifs: [] });
  mockCategories.mockResolvedValue([
    { id: 'cat1', slug: 'jeux', nameFr: 'Jeux de société', nameEn: 'Board games', icon: 'dice-5', parentId: null },
    { id: 'cat2', slug: 'sport', nameFr: 'Sport', nameEn: 'Sport', icon: 'dumbbell', parentId: null },
  ]);
  mockSearchAssoc.mockResolvedValue([]);
  (shareActivity as jest.Mock).mockResolvedValue(undefined);
});

const next = () => screen.getByLabelText('Suivant');
const disabled = (el: { props: any }) => el.props.accessibilityState?.disabled === true;

async function open() {
  await render(<NewActivity />);
  await screen.findByText('Étape 1 sur 5');
}
async function toWhat() {
  await open();
  await fireEvent.press(next());
  await screen.findByText('Étape 2 sur 5');
}
async function fillWhat(title = 'Soirée jeux au bar') {
  await fireEvent.press(await screen.findByLabelText('Jeux de société'));
  await fireEvent.changeText(screen.getByLabelText('Titre'), title);
}
async function pickTown() {
  await fireEvent.press(screen.getByLabelText('Saisir une ville'));
  await fireEvent.changeText(screen.getByLabelText('Nom de la ville'), 'Lyon');
  await fireEvent.press(await screen.findByLabelText('Lyon (69001)'));
}
async function toWhere() {
  await toWhat();
  await fillWhat();
  await fireEvent.press(next());
  await screen.findByText('Étape 3 sur 5');
}
async function fillWhere(label = 'Café des Arts') {
  await pickTown();
  await fireEvent.changeText(screen.getByLabelText('Nom du lieu'), label);
}

it('asks for an account first and leaves when the sheet is closed', async () => {
  mockGate.mockResolvedValue(false);
  await render(<NewActivity />);
  await waitFor(() => expect(router.back).toHaveBeenCalled());
  expect(mockGate).toHaveBeenCalledWith('create');
  expect(screen.queryByText('Étape 1 sur 5')).toBeNull();
});

it('starts on "Qui organise ?" with "Moi" selected and Suivant enabled', async () => {
  await open();
  expect(screen.getByText('Qui organise ?')).toBeTruthy();
  expect(screen.getByLabelText('Moi').props.accessibilityState.selected).toBe(true);
  expect(disabled(next())).toBe(false);
});

it('keeps Suivant disabled until the title has 3 characters and a category is chosen', async () => {
  await toWhat();
  expect(disabled(next())).toBe(true);
  await fireEvent.press(await screen.findByLabelText('Jeux de société'));
  await fireEvent.changeText(screen.getByLabelText('Titre'), 'ab');
  expect(disabled(next())).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Titre'), 'abc');
  expect(disabled(next())).toBe(false);
});

it('fills the title and description from a template', async () => {
  await toWhat();
  await fireEvent.press(screen.getByLabelText('Course à pied du dimanche'));
  expect(screen.getByLabelText('Titre').props.value).toBe('Course à pied du dimanche');
  expect(screen.getByLabelText('Description').props.value).toContain('Footing');
  await fireEvent.press(screen.getByLabelText('Échange de langues au café'));
  expect(screen.getByLabelText('Titre').props.value).toBe('Échange de langues au café');
  expect(screen.getByLabelText('Soirée jeux de société hebdomadaire')).toBeTruthy();
});

it('shows the home tip on "Où ?" and needs a place label', async () => {
  await toWhere();
  expect(screen.getByText('Où ?')).toBeTruthy();
  expect(screen.getByText(HOME_TIP)).toBeTruthy();
  expect(disabled(next())).toBe(true);
  await pickTown();
  expect(screen.getByText(HOME_TIP)).toBeTruthy();
  expect(disabled(next())).toBe(true); // pin set, label still empty
  await fireEvent.changeText(screen.getByLabelText('Nom du lieu'), 'Café des Arts');
  expect(disabled(next())).toBe(false);
});

it('moves the pin when the map is touched', async () => {
  mockCreate.mockResolvedValue({ ok: true, id: 'act9' });
  await toWhere();
  await fillWhere();
  await fireEvent(screen.getByTestId('map'), 'press', { nativeEvent: { lngLat: [4.9, 45.8] } });
  await fireEvent.press(next());
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2030-05-14');
  await fireEvent.press(next());
  await fireEvent.press(screen.getByLabelText('Publier'));
  await screen.findByText('Partagez-la avec vos amis');
  expect(mockCreate.mock.calls[0][0].place).toEqual({ label: 'Café des Arts', lon: 4.9, lat: 45.8 });
});

it('rejects a past date and a bad time on "Quand ?"', async () => {
  await toWhere();
  await fillWhere();
  await fireEvent.press(next());
  await screen.findByText('Étape 4 sur 5');
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2020-01-01');
  expect(disabled(next())).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2030-05-14');
  expect(disabled(next())).toBe(false);
  await fireEvent.changeText(screen.getByLabelText('Heure'), '25:00');
  expect(disabled(next())).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Heure'), '19:30');
  expect(disabled(next())).toBe(false);
  await fireEvent.press(screen.getByLabelText('Certains jours'));
  expect(disabled(next())).toBe(true); // at least one weekday
  await fireEvent.press(screen.getByLabelText('Mardi'));
  expect(disabled(next())).toBe(false);
});

it('validates the maximum size on "Réglages"', async () => {
  await toWhere();
  await fillWhere();
  await fireEvent.press(next());
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2030-05-14');
  await fireEvent.press(next());
  await screen.findByText('Étape 5 sur 5');
  expect(disabled(screen.getByLabelText('Publier'))).toBe(false); // empty = no limit
  await fireEvent.changeText(screen.getByLabelText('Nombre maximum de participants'), '1');
  expect(disabled(screen.getByLabelText('Publier'))).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Nombre maximum de participants'), '201');
  expect(disabled(screen.getByLabelText('Publier'))).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Nombre maximum de participants'), '12');
  expect(disabled(screen.getByLabelText('Publier'))).toBe(false);
});

it('offers "Créer un collectif" when there is none, and selects the new one', async () => {
  mockCreateCollectif.mockResolvedValue({ ok: true, id: 'c9' });
  await open();
  await fireEvent.press(screen.getByLabelText('Un collectif'));
  expect(disabled(next())).toBe(true);
  await fireEvent.press(await screen.findByLabelText('Créer un collectif'));
  await fireEvent.changeText(screen.getByLabelText('Nom du collectif'), 'Les Joueurs du jeudi');
  await fireEvent.changeText(screen.getByLabelText('Description du collectif'), 'Une bande de joueurs');
  await pickTown();
  await fireEvent.press(screen.getByLabelText('Créer le collectif'));
  await waitFor(() =>
    expect(mockCreateCollectif).toHaveBeenCalledWith({
      name: 'Les Joueurs du jeudi',
      description: 'Une bande de joueurs',
      town: { label: 'Lyon (69001)', lon: 4.83, lat: 45.76 },
    }),
  );
  const row = await screen.findByLabelText('Les Joueurs du jeudi');
  expect(row.props.accessibilityState.selected).toBe(true);
  expect(disabled(next())).toBe(false);
  expect(screen.getAllByText('Collectif — sans statut juridique').length).toBeGreaterThan(0);
});

it('lists my collectifs and selects one', async () => {
  mockCollectifs.mockResolvedValue({
    ok: true,
    collectifs: [{ id: 'c1', name: 'Marcheurs', townLabel: 'Lyon', role: 'organiser' }],
  });
  await open();
  await fireEvent.press(screen.getByLabelText('Un collectif'));
  await fireEvent.press(await screen.findByLabelText('Marcheurs'));
  expect(screen.getByLabelText('Marcheurs').props.accessibilityState.selected).toBe(true);
  expect(disabled(next())).toBe(false);
});

it('picks a linkable association from the directory', async () => {
  mockSearchAssoc.mockResolvedValue([{ id: 'a1', name: 'Club des Lilas', address: 'Lyon' }]);
  await open();
  await fireEvent.press(screen.getByLabelText('Une association'));
  expect(disabled(next())).toBe(true);
  await fireEvent.changeText(screen.getByLabelText('Rechercher une association'), 'Lilas');
  await fireEvent.press(await screen.findByLabelText('Club des Lilas'));
  expect(mockSearchAssoc).toHaveBeenCalledWith('Lilas', 'u1');
  expect(disabled(next())).toBe(false);
});

it('adds an unlisted club through the community path and selects it', async () => {
  mockAddClub.mockResolvedValue({ ok: true, id: 'a7' });
  await open();
  await fireEvent.press(screen.getByLabelText('Une association'));
  await fireEvent.press(screen.getByLabelText('Ajouter ce club'));
  await fireEvent.changeText(screen.getByLabelText("Nom du club ou de l'association"), 'Les Boulistes');
  await fireEvent.press(screen.getByLabelText("Ajouter à l'annuaire"));
  await waitFor(() => expect(mockAddClub).toHaveBeenCalledWith({ name: 'Les Boulistes', website: '' }));
  await waitFor(() => expect(disabled(next())).toBe(false));
});

async function reachPublish() {
  await toWhere();
  await fillWhere();
  await fireEvent.press(next());
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2030-05-14');
  await fireEvent.changeText(screen.getByLabelText('Heure'), '19:30');
  await fireEvent.press(next());
  await screen.findByText('Étape 5 sur 5');
}

it('publishes the expected draft and offers to share', async () => {
  mockCreate.mockResolvedValue({ ok: true, id: 'act1' });
  await reachPublish();
  await fireEvent.changeText(screen.getByLabelText('Nombre maximum de participants'), '10');
  await fireEvent.press(screen.getByLabelText('Sur demande'));
  await fireEvent.press(screen.getByLabelText('Publier'));
  await screen.findByText('Partagez-la avec vos amis');
  expect(mockCreate).toHaveBeenCalledWith({
    organisedBy: { kind: 'me' },
    categoryId: 'cat1',
    title: 'Soirée jeux au bar',
    description: '',
    place: { label: 'Café des Arts', lon: 4.83, lat: 45.76 },
    startDate: '2030-05-14',
    startTime: '19:30',
    recurrence: { kind: 'weekly' },
    maxSize: 10,
    newcomerFriendly: false,
    approvalMode: 'approval',
  });
  await fireEvent.press(screen.getByLabelText('Partager'));
  expect(shareActivity).toHaveBeenCalledWith('act1', 'Soirée jeux au bar');
  await fireEvent.press(screen.getByLabelText("Voir l'activité"));
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/activites/[id]',
    params: { id: 'act1', title: 'Soirée jeux au bar' },
  });
});

it('sends no limit and an every-N-days recurrence', async () => {
  mockCreate.mockResolvedValue({ ok: true, id: 'act2' });
  await toWhere();
  await fillWhere();
  await fireEvent.press(next());
  await fireEvent.changeText(screen.getByLabelText('Date de début'), '2030-05-14');
  await fireEvent.press(screen.getByLabelText('Tous les 7 jours'));
  await fireEvent.changeText(screen.getByLabelText('Nombre de jours'), '3');
  await fireEvent.press(next());
  await fireEvent(screen.getByLabelText('Débutants bienvenus'), 'valueChange', true);
  await fireEvent.press(screen.getByLabelText('Publier'));
  await screen.findByText('Partagez-la avec vos amis');
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    recurrence: { kind: 'every_n_days', days: 3 },
    maxSize: null,
    newcomerFriendly: true,
    approvalMode: 'open',
  });
});

it('explains the daily limit when publishing is refused with limit_reached', async () => {
  mockCreate.mockResolvedValue({ ok: false, error: 'limit_reached' });
  await reachPublish();
  await fireEvent.press(screen.getByLabelText('Publier'));
  expect(await screen.findByText(/3 activités et 2 collectifs/)).toBeTruthy();
  expect(screen.queryByText('Partagez-la avec vos amis')).toBeNull();
  expect(disabled(screen.getByLabelText('Publier'))).toBe(false);
});

it('explains the 24-hour rule on not_allowed', async () => {
  mockCreate.mockResolvedValue({ ok: false, error: 'not_allowed' });
  await reachPublish();
  await fireEvent.press(screen.getByLabelText('Publier'));
  expect(await screen.findByText(/au moins 24 heures/)).toBeTruthy();
});

it('goes back a step keeping what was typed', async () => {
  await toWhat();
  await fillWhat('Mon titre');
  await fireEvent.press(screen.getByLabelText('Retour'));
  await screen.findByText('Étape 1 sur 5');
  await fireEvent.press(next());
  expect(screen.getByLabelText('Titre').props.value).toBe('Mon titre');
});
