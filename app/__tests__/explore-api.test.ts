import { addWaiter, embedQuery, getAssociation, removeWaiter, searchExplore, searchTowns } from '../src/features/explore/api';
import type { ExploreParams } from '../src/features/explore/types';

const mockInvoke = jest.fn();
const mockRpc = jest.fn();
const mockInsert = jest.fn();
const mockEqUser = jest.fn();
const mockEqAssoc = jest.fn(() => ({ eq: mockEqUser }));
const mockDelete = jest.fn(() => ({ eq: mockEqAssoc }));
const mockFrom = jest.fn(() => ({ insert: mockInsert, delete: mockDelete }));
const mockGetSession = jest.fn();

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => (mockFrom as (...x: unknown[]) => unknown)(...a),
    auth: { getSession: () => mockGetSession() },
  },
}));

const params: ExploreParams = {
  query: 'Judo',
  center: { lon: 4.8, lat: 45.7 },
  radiusKm: 10,
  kinds: ['activity'],
  weekday: null,
  newcomerFriendly: false,
  interestCategoryIds: [],
  sort: 'best',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('embedQuery', () => {
  it('resolves null when invoke rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'));
    await expect(embedQuery('judo')).resolves.toBeNull();
  });

  it('resolves null when invoke returns an error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('502') });
    await expect(embedQuery('judo')).resolves.toBeNull();
  });

  it('resolves null after 8 s when invoke never resolves', async () => {
    jest.useFakeTimers();
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const p = embedQuery('judo');
    await jest.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBeNull();
  });

  it('resolves null for a vector that is not 384 numbers', async () => {
    mockInvoke.mockResolvedValue({ data: { embedding: [1, 2, 3] }, error: null });
    await expect(embedQuery('judo')).resolves.toBeNull();
  });

  it('returns a valid 384-number vector', async () => {
    const v = Array.from({ length: 384 }, () => 0.1);
    mockInvoke.mockResolvedValue({ data: { embedding: v }, error: null });
    await expect(embedQuery('judo')).resolves.toEqual(v);
    expect(mockInvoke).toHaveBeenCalledWith('embed-query', { body: { text: 'judo' } });
  });
});

describe('searchExplore', () => {
  it('sends snake_case args and maps the response to camelCase', async () => {
    mockRpc.mockResolvedValue({
      data: {
        mode: 'search',
        results: [
          {
            kind: 'activity', id: 'a1', title: 'Judo', subtitle: 'Lyon', snippet: null,
            lon: 4.8, lat: 45.7, distance_km: 2.5, score: 80, label: 'very_relevant',
            is_weak: false, is_new: true, source_label: null, tag_slugs: ['sport'],
          },
        ],
        strong_count: 1, strong_count_50km: 3, suggest_radius_km: 50, has_more: true,
      },
      error: null,
    });
    const res = await searchExplore(params, { limit: 20, offset: 0 }, null);
    expect(mockRpc).toHaveBeenCalledWith(
      'search_explore',
      expect.objectContaining({
        p_lon: 4.8, p_lat: 45.7, p_radius_km: 10, p_query_embedding: null,
        p_kinds: ['activity'], p_weekday: null, p_newcomer_friendly: false,
        p_interest_category_ids: [], p_sort: 'best', p_limit: 20, p_offset: 0,
      }),
    );
    expect(res.results[0].distanceKm).toBe(2.5);
    expect(res.results[0].tagSlugs).toEqual(['sport']);
    expect(res.results[0].isNew).toBe(true);
    expect(res.strongCount).toBe(1);
    expect(res.strongCount50km).toBe(3);
    expect(res.suggestRadiusKm).toBe(50);
    expect(res.hasMore).toBe(true);
  });

  it('throws ExploreError on RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(searchExplore(params, { limit: 20, offset: 0 }, null)).rejects.toMatchObject({
      name: 'ExploreError',
    });
  });
});

describe('addWaiter', () => {
  it('returns signed_out without inserting when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(addWaiter('assoc-1')).resolves.toBe('signed_out');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts a row for a signed-in user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockInsert.mockResolvedValue({ error: null });
    await expect(addWaiter('assoc-1')).resolves.toBe('added');
    expect(mockFrom).toHaveBeenCalledWith('association_waiters');
    expect(mockInsert).toHaveBeenCalledWith({ association_id: 'assoc-1', user_id: 'u1' });
  });
});

describe('searchTowns', () => {
  it('maps the geo.api payload', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { nom: 'Lyon', codesPostaux: ['69001', '69002'], centre: { type: 'Point', coordinates: [4.835, 45.758] } },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(searchTowns('Lyon')).resolves.toEqual([
      { label: 'Lyon (69001)', lon: 4.835, lat: 45.758 },
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://geo.api.gouv.fr/communes?nom=Lyon&fields=nom,centre,codesPostaux&boost=population&limit=5',
    );
  });
});

describe('getAssociation', () => {
  it('returns null when the RPC returns null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(getAssociation('x')).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('get_association', { p_id: 'x' });
  });

  it('maps snake_case to camelCase', async () => {
    mockRpc.mockResolvedValue({
      data: {
        id: 'a', name: 'Club', purpose: 'p', city: 'Lyon', postcode: '69001', lon: 1, lat: 2,
        website: null, phone: null, email: null, opening_hours: 'lun', source: 'rna',
        verified: true, claimed: false, source_label: null, attribution_keys: ['k'],
        tags: [{ slug: 's', label_fr: 'Sport', label_en: 'Sport' }],
        activities: [{ id: 'x', title: 'Judo' }], can_wait: true, is_waiting: false,
      },
      error: null,
    });
    const a = await getAssociation('a');
    expect(a?.openingHours).toBe('lun');
    expect(a?.attributionKeys).toEqual(['k']);
    expect(a?.tags[0]).toEqual({ slug: 's', labelFr: 'Sport', labelEn: 'Sport' });
    expect(a?.canWait).toBe(true);
    expect(a?.isWaiting).toBe(false);
  });
});

describe('removeWaiter', () => {
  it('deletes with both association and user ids', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockEqUser.mockResolvedValue({ error: null });
    await removeWaiter('assoc-1');
    expect(mockFrom).toHaveBeenCalledWith('association_waiters');
    expect(mockEqAssoc).toHaveBeenCalledWith('association_id', 'assoc-1');
    expect(mockEqUser).toHaveBeenCalledWith('user_id', 'u1');
  });
});
