import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { searchExplore } from '../src/features/explore/api';
import type { ExploreParams, ExploreResponse, ExploreResult } from '../src/features/explore/types';
import { useExploreLocation } from '../src/features/explore/useExploreLocation';
import { useExploreSearch } from '../src/features/explore/useExploreSearch';

jest.mock('../src/features/explore/api');
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockSearch = searchExplore as jest.Mock;

const base: ExploreParams = {
  query: '',
  center: { lon: 4.8, lat: 45.7 },
  radiusKm: 10,
  kinds: ['activity', 'association'],
  weekday: null,
  newcomerFriendly: false,
  interestCategoryIds: [],
  sort: 'best',
};

function result(id: string): ExploreResult {
  return {
    kind: 'activity', id, title: id, subtitle: null, snippet: null, lon: 0, lat: 0,
    distanceKm: 1, score: 50, label: null, isWeak: false, isNew: false, sourceLabel: null, tagSlugs: [],
  };
}
function response(ids: string[], hasMore = false): ExploreResponse {
  return {
    mode: 'search', results: ids.map(result), strongCount: 0, strongCount50km: 0,
    suggestRadiusKm: null, hasMore,
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockSearch.mockResolvedValue(response(['x']));
  await AsyncStorage.clear();
});
afterEach(() => jest.useRealTimers());

describe('useExploreSearch', () => {
  it('debounces typing: three quick characters trigger one search after 350 ms', async () => {
    const { rerender } = await renderHook((p: ExploreParams) => useExploreSearch(p), {
      initialProps: base,
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(0); });
    mockSearch.mockClear();
    await rerender({ ...base, query: 'd' });
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    await rerender({ ...base, query: 'da' });
    await act(async () => { await jest.advanceTimersByTimeAsync(100); });
    await rerender({ ...base, query: 'dan' });
    await act(async () => { await jest.advanceTimersByTimeAsync(349); });
    expect(mockSearch).not.toHaveBeenCalled();
    await act(async () => { await jest.advanceTimersByTimeAsync(2); });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0][0].query).toBe('dan');
  });

  it('typing a query calls searchExplore once after 350 ms, with no embedding argument', async () => {
    await renderHook(() => useExploreSearch({ ...base, query: 'yoga nidra' }));
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch.mock.calls[0]).toHaveLength(2);
  });

  it('loadMore requests offset 20 and appends', async () => {
    const first = Array.from({ length: 20 }, (_, i) => `a${i}`);
    mockSearch.mockResolvedValueOnce(response(first, true)).mockResolvedValueOnce(response(['b0'], false));
    const { result: hook } = await renderHook(() => useExploreSearch({ ...base }));
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(hook.current.results).toHaveLength(20);
    await act(async () => { hook.current.loadMore(); await jest.advanceTimersByTimeAsync(0); });
    expect(mockSearch.mock.calls[1][1]).toEqual({ limit: 20, offset: 20 });
    expect(hook.current.results).toHaveLength(21);
    expect(hook.current.results[20].id).toBe('b0');
  });

  it('a failed next page keeps the results and sets loadMoreError, and loadMore retries', async () => {
    const first = Array.from({ length: 20 }, (_, i) => `a${i}`);
    mockSearch
      .mockResolvedValueOnce(response(first, true))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(response(['b0'], false));
    const { result: hook } = await renderHook(() => useExploreSearch({ ...base }));
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    await act(async () => { hook.current.loadMore(); await jest.advanceTimersByTimeAsync(0); });
    expect(hook.current.results).toHaveLength(20);
    expect(hook.current.error).toBe(false);
    expect(hook.current.loadMoreError).toBe(true);
    await act(async () => { hook.current.loadMore(); await jest.advanceTimersByTimeAsync(0); });
    expect(mockSearch.mock.calls[2][1]).toEqual({ limit: 20, offset: 20 });
    expect(hook.current.loadMoreError).toBe(false);
    expect(hook.current.results).toHaveLength(21);
  });

  it('retry runs a failed first page again', async () => {
    mockSearch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(response(['x']));
    const { result: hook } = await renderHook(() => useExploreSearch({ ...base }));
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(hook.current.error).toBe(true);
    await act(async () => { hook.current.retry(); await jest.advanceTimersByTimeAsync(0); });
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[1][1]).toEqual({ limit: 20, offset: 0 });
    expect(hook.current.error).toBe(false);
    expect(hook.current.results.map((r) => r.id)).toEqual(['x']);
  });

  it('discards a slower earlier response', async () => {
    let resolveSlow!: (r: ExploreResponse) => void;
    mockSearch
      .mockReturnValueOnce(new Promise<ExploreResponse>((r) => { resolveSlow = r; }))
      .mockResolvedValueOnce(response(['fast']));
    const { result: hook, rerender } = await renderHook((p: ExploreParams) => useExploreSearch(p), {
      initialProps: { ...base, query: 'slow' },
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    await rerender({ ...base, query: 'fast' });
    await act(async () => { await jest.advanceTimersByTimeAsync(400); });
    expect(hook.current.results.map((r) => r.id)).toEqual(['fast']);
    await act(async () => { resolveSlow(response(['slow'])); await jest.advanceTimersByTimeAsync(0); });
    expect(hook.current.results.map((r) => r.id)).toEqual(['fast']);
    expect(hook.current.loading).toBe(false);
  });
});

describe('useExploreLocation', () => {
  it('requestGps denied returns denied and keeps status needed', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied', granted: false });
    const { result: hook } = await renderHook(() => useExploreLocation());
    await waitFor(() => expect(hook.current.status).toBe('needed'));
    let outcome: string | undefined;
    await act(async () => { outcome = await hook.current.requestGps(); });
    expect(outcome).toBe('denied');
    expect(hook.current.status).toBe('needed');
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('requestGps granted stores the position rounded to ~1 km, with the translation key label', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', granted: true });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { longitude: 2.35219, latitude: 48.85661 } });
    const { result: hook } = await renderHook(() => useExploreLocation());
    await waitFor(() => expect(hook.current.status).toBe('needed'));
    await act(async () => { await hook.current.requestGps(); });
    expect(hook.current.status).toBe('ready');
    const rounded = { label: 'explore.location.myPosition', lon: 2.35, lat: 48.86, source: 'gps' };
    expect(hook.current.location).toEqual(rounded);
    expect(JSON.parse((await AsyncStorage.getItem('explore.location')) as string)).toEqual(rounded);
  });

  it('setTown persists to explore.location', async () => {
    const { result: hook } = await renderHook(() => useExploreLocation());
    await waitFor(() => expect(hook.current.status).toBe('needed'));
    await act(async () => { await hook.current.setTown({ label: 'Lyon (69001)', lon: 4.835, lat: 45.758 }); });
    const stored = JSON.parse((await AsyncStorage.getItem('explore.location')) as string);
    expect(stored).toEqual({ label: 'Lyon (69001)', lon: 4.835, lat: 45.758, source: 'town' });
    expect(hook.current.status).toBe('ready');
  });

  it('loads a stored location on mount', async () => {
    await AsyncStorage.setItem('explore.location', JSON.stringify({ label: 'Nice', lon: 7.2, lat: 43.7, source: 'town' }));
    const { result: hook } = await renderHook(() => useExploreLocation());
    await waitFor(() => expect(hook.current.status).toBe('ready'));
    expect(hook.current.location?.label).toBe('Nice');
  });
});
