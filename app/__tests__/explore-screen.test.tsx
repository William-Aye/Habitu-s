import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ExploreParams, ExploreResponse, ExploreResult } from '../src/features/explore/types';
import { initI18n } from '../src/i18n';
import Explore from '../src/app/(tabs)/index';
import { useExploreLocation } from '../src/features/explore/useExploreLocation';
import { useExploreSearch } from '../src/features/explore/useExploreSearch';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../src/features/explore/api', () => ({ searchTowns: jest.fn(async () => []) }));
jest.mock('../src/features/explore/useExploreLocation', () => ({
  useExploreLocation: jest.fn(),
}));
jest.mock('../src/features/explore/useExploreSearch', () => ({
  useExploreSearch: jest.fn(),
}));

// The first render of the Explore screen loads its whole module tree (maps, icons, expo modules),
// which takes several seconds on a cold CI runner.
jest.setTimeout(60000);

const mockLocation = useExploreLocation as jest.Mock;
const mockSearch = useExploreSearch as jest.Mock;

const PLACEHOLDER = 'Rechercher une activité, un club, une association…';

function result(id: string, over: Partial<ExploreResult> = {}): ExploreResult {
  return {
    kind: 'activity', id, title: `Titre ${id}`, subtitle: null, snippet: null, lon: 0, lat: 0,
    distanceKm: 1, score: 50, label: null, isWeak: false, isNew: false, sourceLabel: null,
    tagSlugs: [], ...over,
  };
}
function response(results: ExploreResult[], over: Partial<ExploreResponse> = {}): ExploreResponse {
  return {
    mode: 'search', results, strongCount: 0, strongCount50km: 0, suggestRadiusKm: null,
    hasMore: false, ...over,
  };
}
function setSearch(res: ExploreResponse | null, results = res?.results ?? []) {
  mockSearch.mockReturnValue({ response: res, results, loading: false, error: false, loadMore: jest.fn() });
}
const lastParams = (): ExploreParams => {
  const calls = mockSearch.mock.calls;
  return calls[calls.length - 1][0];
};

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  mockLocation.mockReturnValue({
    location: { label: 'Lyon', lon: 4.8, lat: 45.7, source: 'town' },
    status: 'ready',
    requestGps: jest.fn(),
    setTown: jest.fn(),
  });
  setSearch(response([], { mode: 'browse' }));
});

it('renders an editable search field first, with the French placeholder', async () => {
  await render(<Explore />);
  const field = screen.getByPlaceholderText(PLACEHOLDER);
  expect(field.props.editable).not.toBe(false);
  const json = JSON.stringify(screen.toJSON());
  expect(json.indexOf(PLACEHOLDER)).toBeGreaterThan(-1);
  expect(json.indexOf(PLACEHOLDER)).toBeLessThan(json.indexOf('Activités'));
  expect(json.indexOf(PLACEHOLDER)).toBeLessThan(json.indexOf('Autour de'));
});

it('renders the five chips and never lets both kinds be off', async () => {
  await render(<Explore />);
  for (const l of ['Activités', 'Clubs et associations', 'Jour', 'Distance', 'Débutants bienvenus']) {
    expect(screen.getByText(l)).toBeTruthy();
  }
  await fireEvent.press(screen.getByText('Activités'));
  expect(lastParams().kinds).toEqual(['association']);
  await fireEvent.press(screen.getByText('Clubs et associations'));
  expect(lastParams().kinds).toEqual(['association']);
  expect(screen.getByText('Clubs et associations')).toBeTruthy();
});

it('disables associations with a hint when a day or newcomer filter is set', async () => {
  await render(<Explore />);
  expect(screen.getByLabelText('Clubs et associations').props.accessibilityHint).toBeUndefined();
  await fireEvent.press(screen.getByText('Débutants bienvenus'));
  expect(lastParams().newcomerFriendly).toBe(true);
  expect(lastParams().kinds).toEqual(['activity']);
  expect(screen.getByText('Ce filtre concerne les activités')).toBeTruthy();
  expect(screen.getByLabelText('Clubs et associations').props.accessibilityHint).toBe(
    'Ce filtre concerne les activités',
  );
});

it('ignores kind toggles while a day or newcomer filter restricts to activities', async () => {
  await render(<Explore />);
  await fireEvent.press(screen.getByText('Débutants bienvenus'));
  await fireEvent.press(screen.getByText('Activités'));
  expect(lastParams().kinds).toEqual(['activity']);
  await fireEvent.press(screen.getByText('Débutants bienvenus'));
  expect(lastParams().kinds).toEqual(['activity', 'association']);
});

it('cancels a location change opened by Modifier', async () => {
  await render(<Explore />);
  await fireEvent.press(screen.getByText('Modifier'));
  expect(screen.getByText('Utiliser ma position')).toBeTruthy();
  await fireEvent.press(screen.getByText('Annuler'));
  expect(screen.queryByText('Utiliser ma position')).toBeNull();
  expect(screen.getByText('Autour de Lyon')).toBeTruthy();
});

it('offers no cancel when no location is set yet', async () => {
  mockLocation.mockReturnValue({
    location: null, status: 'needed', requestGps: jest.fn(), setTown: jest.fn(),
  });
  setSearch(null);
  await render(<Explore />);
  expect(screen.queryByText('Annuler')).toBeNull();
});

it('shows a retry button when the first page fails', async () => {
  const retry = jest.fn();
  mockSearch.mockReturnValue({
    response: null, results: [], loading: false, error: true, loadMoreError: false,
    loadMore: jest.fn(), retry,
  });
  await render(<Explore />);
  expect(screen.getByText('Impossible de charger les résultats. Réessayez.')).toBeTruthy();
  await fireEvent.press(screen.getByText('Réessayer'));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('keeps the results when the next page fails, with an inline retry', async () => {
  const loadMore = jest.fn();
  const res = response([result('a', { title: 'Alpha' })], { hasMore: true });
  mockSearch.mockReturnValue({
    response: res, results: res.results, loading: false, error: false, loadMoreError: true,
    loadMore, retry: jest.fn(),
  });
  await render(<Explore />);
  expect(screen.getByText('Alpha')).toBeTruthy();
  await fireEvent.press(screen.getByText('Réessayer'));
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('opens the day and distance sheets', async () => {
  await render(<Explore />);
  await fireEvent.press(screen.getByText('Jour'));
  await fireEvent.press(screen.getByText('Lundi'));
  expect(lastParams().weekday).toBe(1);
  await fireEvent.press(screen.getByLabelText('Distance'));
  await fireEvent.press(screen.getByText('25 km'));
  expect(lastParams().radiusKm).toBe(25);
});

it('inserts one divider before the first weak result and shows match labels', async () => {
  const rs = [
    result('a', { score: 75, label: 'very_relevant', title: 'Alpha' }),
    result('b', { score: 55, label: 'relevant', title: 'Bravo' }),
    result('c', { score: 40, label: 'weak', isWeak: true, title: 'Charlie' }),
    result('d', { score: 30, label: 'weak', isWeak: true, title: 'Delta' }),
  ];
  setSearch(response(rs));
  await render(<Explore />);
  expect(screen.getAllByText('Moins proche de votre recherche')).toHaveLength(1);
  const order = screen
    .getAllByText(/^(Bravo|Charlie|Moins proche de votre recherche)$/)
    .map((n) => n.props.children);
  expect(order).toEqual(['Bravo', 'Moins proche de votre recherche', 'Charlie']);
  expect(screen.getByText('Très pertinent')).toBeTruthy();
  expect(screen.getByText('Pertinent')).toBeTruthy();
  expect(screen.getAllByText('Peu pertinent').length).toBeGreaterThan(0);
});

it('shows the widen banner and widens to 50 km', async () => {
  setSearch(
    response([result('a')], { strongCount: 3, strongCount50km: 11, suggestRadiusKm: 50 }),
  );
  await render(<Explore />);
  expect(screen.getByText('3 résultats pertinents à 10 km — 11 à 50 km')).toBeTruthy();
  await fireEvent.press(screen.getByText('Élargir à 50 km'));
  expect(lastParams().radiusKm).toBe(50);
});

it('shows the widen banner on an empty result when there are matches at 50 km', async () => {
  setSearch(response([], { strongCount: 0, strongCount50km: 4, suggestRadiusKm: 50 }));
  await render(<Explore />);
  await fireEvent.changeText(screen.getByPlaceholderText(PLACEHOLDER), 'curling');
  expect(screen.getByText("Aucun résultat pertinent près d'ici")).toBeTruthy();
  expect(screen.getByText('0 résultat pertinent à 10 km — 4 à 50 km')).toBeTruthy();
  await fireEvent.press(screen.getByText('Élargir à 50 km'));
  expect(lastParams().radiusKm).toBe(50);
});

it('gives screen readers every visible text of a result card', async () => {
  setSearch(
    response([
      result('a', {
        kind: 'association', title: 'Club de Go', subtitle: 'Lyon', distanceKm: 2.4,
        label: 'very_relevant', isNew: true, sourceLabel: 'unverified',
      }),
    ]),
  );
  await render(<Explore />);
  expect(
    screen.getByLabelText('Club de Go, Lyon, 2,4 km, Très pertinent, Nouvelle, non vérifié'),
  ).toBeTruthy();
});

it('shows Nouvelle, community label and French distance', async () => {
  setSearch(
    response([
      result('a', { isNew: true, distanceKm: 2.4 }),
      result('b', { kind: 'association', sourceLabel: 'community' }),
    ]),
  );
  await render(<Explore />);
  expect(screen.getByText('Nouvelle')).toBeTruthy();
  expect(screen.getByText('Ajouté par la communauté')).toBeTruthy();
  expect(screen.getByText('2,4 km')).toBeTruthy();
});

it('asks for a location instead of showing results when none is set', async () => {
  mockLocation.mockReturnValue({
    location: null, status: 'needed', requestGps: jest.fn(), setTown: jest.fn(),
  });
  setSearch(null);
  await render(<Explore />);
  expect(screen.getByText('Utiliser ma position')).toBeTruthy();
  expect(screen.getByText('Saisir une ville')).toBeTruthy();
  expect(screen.queryByText('Près de chez vous')).toBeNull();
  expect(mockSearch).toHaveBeenLastCalledWith(null);
});

it('offers create and feedback buttons on an empty search, with a coming-soon notice', async () => {
  setSearch(response([]));
  await render(<Explore />);
  await fireEvent.changeText(screen.getByPlaceholderText(PLACEHOLDER), 'zzz');
  expect(screen.getByText("Aucun résultat pertinent près d'ici")).toBeTruthy();
  expect(screen.getByText('Créer une activité')).toBeTruthy();
  await fireEvent.press(screen.getByText('Créer une activité'));
  expect(screen.getByText('Bientôt disponible')).toBeTruthy();
  expect(screen.getByText('Une idée ? Un problème ?')).toBeTruthy();
});

it('contains no emoji in rendered text', async () => {
  setSearch(
    response(
      [result('a', { isNew: true, label: 'relevant', sourceLabel: 'unverified' })],
      { strongCount: 3, strongCount50km: 11, suggestRadiusKm: 50 },
    ),
  );
  await render(<Explore />);
  await act(async () => {});
  const texts = screen
    .getAllByText(/[\s\S]+/)
    .map((n) => [n.props.children].flat().join(''))
    .join('\n');
  expect(texts).toContain('Nouvelle');
  expect(/\p{Extended_Pictographic}/u.test(texts)).toBe(false);
});
