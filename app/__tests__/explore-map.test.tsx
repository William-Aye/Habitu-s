import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ExploreResponse, ExploreResult } from '../src/features/explore/types';
import { initI18n } from '../src/i18n';
import Explore from '../src/app/(tabs)/index';
import { useExploreLocation } from '../src/features/explore/useExploreLocation';
import { useExploreSearch } from '../src/features/explore/useExploreSearch';
import { ATTRIBUTION, MAP_STYLE_URL } from '../src/features/explore/map';
import { ResultsMap } from '../src/features/explore/components/ResultsMap';
import { TownMap } from '../src/features/explore/components/TownMap';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../src/features/explore/api', () => ({ searchTowns: jest.fn(async () => []) }));
jest.mock('../src/features/explore/useExploreLocation', () => ({ useExploreLocation: jest.fn() }));
jest.mock('../src/features/explore/useExploreSearch', () => ({ useExploreSearch: jest.fn() }));

function result(id: string, over: Partial<ExploreResult> = {}): ExploreResult {
  return {
    kind: 'activity', id, title: `Titre ${id}`, subtitle: null, snippet: null, lon: 4.8, lat: 45.7,
    distanceKm: 1, score: 50, label: null, isWeak: false, isNew: false, sourceLabel: null,
    tagSlugs: [], ...over,
  };
}
const RESULTS = [result('a', { lon: 4.81 }), result('b', { kind: 'association', lat: 45.71 })];

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  (useExploreLocation as jest.Mock).mockReturnValue({
    location: { label: 'Lyon', lon: 4.8, lat: 45.7, source: 'town' },
    status: 'ready',
    requestGps: jest.fn(),
    setTown: jest.fn(),
  });
  const response: ExploreResponse = {
    mode: 'browse', results: RESULTS, strongCount: 0, strongCount50km: 0,
    suggestRadiusKm: null, hasMore: false,
  };
  (useExploreSearch as jest.Mock).mockReturnValue({
    response, results: RESULTS, loading: false, error: false, loadMore: jest.fn(),
  });
});

it('toggles to the map with one marker per result, hides the list, and restores it', async () => {
  await render(<Explore />);
  expect(screen.getAllByText('Titre a').length).toBe(1);
  await fireEvent.press(screen.getByLabelText('Carte'));
  expect(screen.getByTestId('map')).toBeTruthy();
  expect(screen.getByLabelText('Titre a')).toBeTruthy();
  expect(screen.getByLabelText('Titre b')).toBeTruthy();
  expect(screen.getAllByTestId('marker')).toHaveLength(2);
  expect(screen.queryByText('Titre a')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Liste'));
  expect(screen.queryByTestId('map')).toBeNull();
  expect(screen.getByText('Titre a')).toBeTruthy();
});

it('passes the OpenFreeMap style, keeps attribution on and renders the text', async () => {
  await render(<ResultsMap results={RESULTS} center={{ lon: 4.8, lat: 45.7 }} radiusKm={10} onOpen={jest.fn()} />);
  const map = screen.getByTestId('map');
  expect(MAP_STYLE_URL).toBe('https://tiles.openfreemap.org/styles/liberty');
  expect(map.props.mapStyle).toBe(MAP_STYLE_URL);
  expect(map.props.attribution).not.toBe(false);
  expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
  expect(ATTRIBUTION).toBe('© OpenMapTiles © OpenStreetMap contributors');
});

it('fits the camera to the radius around the centre', async () => {
  await render(<ResultsMap results={RESULTS} center={{ lon: 4.8, lat: 45.7 }} radiusKm={10} onOpen={jest.fn()} />);
  const [w, s, e, n] = screen.getByTestId('camera').props.bounds as number[];
  expect(w).toBeLessThan(4.8);
  expect(e).toBeGreaterThan(4.8);
  expect(s).toBeLessThan(45.7);
  expect(n).toBeGreaterThan(45.7);
  expect(n - s).toBeCloseTo(20 / 111.32, 2);
});

it('shows a compact card on marker tap that opens the result', async () => {
  const onOpen = jest.fn();
  await render(<ResultsMap results={RESULTS} center={{ lon: 4.8, lat: 45.7 }} radiusKm={10} onOpen={onOpen} />);
  expect(screen.queryByTestId('map-card')).toBeNull();
  await fireEvent.press(screen.getAllByTestId('marker')[0]);
  expect(screen.getByTestId('map-card')).toBeTruthy();
  await fireEvent.press(within(screen.getByTestId('map-card')).getByRole('button'));
  expect(onOpen).toHaveBeenCalledWith(RESULTS[0]);
});

it('TownMap renders a circle layer, no point marker, fixed zoom 12, non-interactive, attributed', async () => {
  await render(<TownMap lon={4.8} lat={45.7} label="Lyon" />);
  expect(screen.getByTestId('layer-circle')).toBeTruthy();
  expect(screen.queryByTestId('marker')).toBeNull();
  expect(screen.getByTestId('camera').props.zoom).toBe(12);
  const map = screen.getByTestId('map');
  expect(map.props.dragPan).toBe(false);
  expect(map.props.touchZoom).toBe(false);
  expect(map.props.mapStyle).toBe(MAP_STYLE_URL);
  expect(map.props.attribution).not.toBe(false);
  expect(map.props.accessibilityLabel).toBe('Lyon');
  expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
});
