import { hasPublicPlaceNearby } from '../src/features/safety/publicPlace';

const mockFetch = jest.fn();
beforeEach(() => {
  jest.useRealTimers();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

const ok = (elements: unknown[]) => ({ ok: true, json: async () => ({ elements }) });
const sentQuery = () => decodeURIComponent(String(mockFetch.mock.calls[0][1].body).replace(/^data=/, ''));

it('posts a 60 m query to Overpass with the coordinates rounded to 4 decimals and nothing else', async () => {
  mockFetch.mockResolvedValue(ok([{ id: 1 }]));
  expect(await hasPublicPlaceNearby(45.764043123, 4.835659987)).toBe(true);
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toBe('https://overpass-api.de/api/interpreter');
  expect(init.method).toBe('POST');
  expect(init.signal).toBeDefined();
  const q = sentQuery();
  expect(q).toContain('around:60,45.764,4.8357');
  expect(q).not.toContain('45.7640');
  expect(q).not.toContain('4.83565');
  expect(q).toContain('["amenity"~"^(cafe|restaurant|bar|pub|library|community_centre|arts_centre|cinema|theatre|townhall|place_of_worship|marketplace|fast_food|ice_cream)$"]');
  expect(q).toContain('["shop"]');
  expect(q).toContain('["leisure"~"^(park|sports_centre|pitch|stadium|playground|fitness_centre|dance)$"]');
  expect(q).toContain('["tourism"~"^(museum|gallery|attraction)$"]');
  expect(q).toContain('["sport"]["leisure"~"^(park|sports_centre|pitch|stadium|playground|fitness_centre|dance)$"]');
  expect(q).toContain('["office"="association"]');
  // a bare key would match private places (a garden, a flat with a pool)
  expect(q).not.toContain('["amenity"]');
  expect(q).not.toContain('["leisure"]');
  expect(q).not.toContain('["tourism"]');
  expect(Object.keys(init.headers ?? {}).map((h) => h.toLowerCase())).toEqual(['content-type']);
});

it('is false when nothing is found within 60 m', async () => {
  mockFetch.mockResolvedValue(ok([]));
  expect(await hasPublicPlaceNearby(45.76, 4.83)).toBe(false);
});

it('is unknown on a network error, a bad status or an unreadable answer', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  expect(await hasPublicPlaceNearby(45.76, 4.83)).toBe('unknown');
  mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
  expect(await hasPublicPlaceNearby(45.76, 4.83)).toBe('unknown');
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ remark: 'runtime error' }) });
  expect(await hasPublicPlaceNearby(45.76, 4.83)).toBe('unknown');
});

it('is unknown (never false) on a 200 with an empty list and a runtime error remark', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ elements: [], remark: 'runtime error: Query timed out in "query" at line 1' }),
  });
  expect(await hasPublicPlaceNearby(45.76, 4.83)).toBe('unknown');
});

it('gives up after 4 seconds and answers unknown', async () => {
  jest.useFakeTimers();
  mockFetch.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const result = hasPublicPlaceNearby(45.76, 4.83);
  await jest.advanceTimersByTimeAsync(3999);
  let settled = false;
  void result.then(() => (settled = true));
  await Promise.resolve();
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(2);
  expect(await result).toBe('unknown');
});
