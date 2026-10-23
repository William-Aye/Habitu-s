import {
  createActivity,
  decideJoinRequest,
  getActivity,
  joinActivity,
  leaveActivity,
  myActivities,
  setAttendance,
  setWelcomeMember,
  updateSession,
} from '../src/features/activities/api';
import { mapError } from '../src/features/activities/errors';
import { addCommunityAssociation, searchLinkableAssociations } from '../src/features/activities/associationDirectory';
import {
  answerInvitation,
  createCollectif,
  deleteCollectif,
  getCollectif,
  inviteOrganiser,
  leaveCollectif,
  myCollectifs,
} from '../src/features/collectifs/api';
import type { ActivityDraft } from '../src/features/activities/types';

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
// Chainable query builder: every method returns the builder; awaiting it resolves to `result`.
let result: { data: unknown; error: unknown } = { data: null, error: null };
const calls: { method: string; args: unknown[] }[] = [];
const builder: any = new Proxy(
  {},
  {
    get: (_t, prop: string) => {
      if (prop === 'then') return (res: (v: unknown) => void) => res(result);
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        return builder;
      };
    },
  },
);
const mockFrom = jest.fn();

// Like the real client, its methods depend on `this`: a detached call (const f = supabase.rpc) throws.
const mockClient: any = {
  rpc(...a: unknown[]) {
    if (this !== mockClient) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    return mockRpc(...a);
  },
  from(...a: unknown[]) {
    if (this !== mockClient) throw new TypeError("Cannot read properties of undefined (reading 'rest')");
    return mockFrom(...a);
  },
  auth: {
    getSession(...a: unknown[]) {
      if (this !== mockClient.auth) throw new TypeError('detached auth');
      return mockGetSession(...a);
    },
  },
};

jest.mock('../src/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

const lastCall = (m: string) => [...calls].reverse().find((c) => c.method === m);
const eqs = () => calls.filter((c) => c.method === 'eq').map((c) => c.args);

beforeEach(() => {
  jest.resetAllMocks();
  calls.length = 0;
  // Updates and deletes ask for the affected rows; one row by default.
  result = { data: [{}], error: null };
  mockFrom.mockImplementation(() => builder);
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
});

const draft: ActivityDraft = {
  organisedBy: { kind: 'me' },
  categoryId: 'cat1',
  title: 'Pétanque',
  description: 'Chaque semaine',
  place: { label: 'Parc', lon: 4.83, lat: 45.76 },
  startDate: '2026-10-27',
  startTime: '19:00',
  recurrence: { kind: 'weekly' },
  maxSize: null,
  newcomerFriendly: true,
  approvalMode: 'open',
};

describe('mapError', () => {
  it('maps database errors', () => {
    expect(mapError({ code: '42501', message: 'limit_reached' })).toBe('limit_reached');
    expect(mapError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('not_allowed');
    expect(mapError({ code: 'P0001', message: 'session_full' })).toBe('session_full');
    expect(mapError({ message: 'TypeError: Network request failed' })).toBe('network');
    expect(mapError({ code: '23505', message: 'duplicate key' })).toBe('not_allowed');
    expect(mapError({ code: '22023', message: 'invalid_website' })).toBe('invalid_website');
    expect(mapError({ code: '22000', message: 'other' })).toBe('unknown');
  });

  it('maps the association guard to association_unavailable, limit_reached first', () => {
    expect(mapError({ code: '42501', message: 'association not linkable' })).toBe('association_unavailable');
    expect(mapError({ code: '42501', message: 'limit_reached; association not linkable' })).toBe('limit_reached');
  });
});

describe('searchLinkableAssociations', () => {
  it('calls the RPC and maps city and postcode', async () => {
    mockRpc.mockResolvedValue({
      data: [{ id: 'a1', name: 'Club des Lilas', city: 'Lyon', postcode: '69001' }],
      error: null,
    });
    expect(await searchLinkableAssociations('  Lilas ')).toEqual([
      { id: 'a1', name: 'Club des Lilas', city: 'Lyon', postcode: '69001' },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('search_linkable_associations', { p_query: 'Lilas', p_limit: 10 });
  });

  it('skips the call under two characters and throws on a database error', async () => {
    expect(await searchLinkableAssociations(' a ')).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(searchLinkableAssociations('Lilas')).rejects.toThrow();
  });
});

describe('addCommunityAssociation', () => {
  it('inserts a community row, prefixing a bare domain with https://', async () => {
    result = { data: { id: 'a7' }, error: null };
    expect(await addCommunityAssociation({ name: ' Les Boulistes ', website: ' boules.example ' })).toEqual({
      ok: true,
      id: 'a7',
    });
    expect(mockFrom).toHaveBeenCalledWith('associations');
    expect(lastCall('insert')?.args[0]).toEqual({
      name: 'Les Boulistes',
      website: 'https://boules.example',
      source: 'community',
      created_by: 'me',
    });
  });

  it.each(['javascript:x', 'mailto:a@b.fr', 'two words.example', 'ftp://x.example'])(
    'refuses %s without calling the database',
    async (website) => {
      expect(await addCommunityAssociation({ name: 'Club', website })).toEqual({ ok: false, error: 'invalid_website' });
      expect(mockFrom).not.toHaveBeenCalled();
    },
  );

  it('treats host:port as a bare domain', async () => {
    result = { data: { id: 'a9' }, error: null };
    await addCommunityAssociation({ name: 'Club', website: 'boules.example:8080/x' });
    expect(lastCall('insert')?.args[0]).toMatchObject({ website: 'https://boules.example:8080/x' });
  });

  it('keeps an http(s) link, sends null for an empty one and maps the limit', async () => {
    result = { data: { id: 'a8' }, error: null };
    await addCommunityAssociation({ name: 'Club', website: 'HTTP://x.example' });
    expect(lastCall('insert')?.args[0]).toMatchObject({ website: 'HTTP://x.example' });
    await addCommunityAssociation({ name: 'Club', website: '' });
    expect(lastCall('insert')?.args[0]).toMatchObject({ website: null });
    result = { data: null, error: { code: '42501', message: 'limit_reached' } };
    expect(await addCommunityAssociation({ name: 'Club', website: '' })).toEqual({ ok: false, error: 'limit_reached' });
  });
});

describe('createActivity', () => {
  it('inserts the draft with a WKT point and the organiser fields', async () => {
    result = { data: { id: 'a1' }, error: null };
    expect(await createActivity(draft)).toEqual({ ok: true, id: 'a1' });
    expect(mockFrom).toHaveBeenCalledWith('activities');
    expect(lastCall('insert')?.args[0]).toEqual({
      organiser_id: 'me',
      organised_by_association_id: null,
      organised_by_collectif_id: null,
      category_id: 'cat1',
      title: 'Pétanque',
      description: 'Chaque semaine',
      place_label: 'Parc',
      place: 'SRID=4326;POINT(4.83 45.76)',
      recurrence_kind: 'weekly',
      recurrence_interval_days: null,
      recurrence_weekdays: null,
      start_date: '2026-10-27',
      start_time: '19:00',
      max_size: null,
      newcomer_friendly: true,
      approval_mode: 'open',
    });
  });

  it('sets the collectif, association and recurrence columns', async () => {
    result = { data: { id: 'a2' }, error: null };
    await createActivity({
      ...draft,
      organisedBy: { kind: 'collectif', id: 'c1' },
      recurrence: { kind: 'every_n_days', days: 3 },
    });
    expect(lastCall('insert')?.args[0]).toMatchObject({
      organised_by_collectif_id: 'c1',
      organised_by_association_id: null,
      recurrence_kind: 'every_n_days',
      recurrence_interval_days: 3,
      recurrence_weekdays: null,
    });
    await createActivity({
      ...draft,
      organisedBy: { kind: 'association', id: 'as1' },
      recurrence: { kind: 'weekdays', weekdays: [1, 4] },
    });
    expect(lastCall('insert')?.args[0]).toMatchObject({
      organised_by_association_id: 'as1',
      organised_by_collectif_id: null,
      recurrence_kind: 'weekdays',
      recurrence_interval_days: null,
      recurrence_weekdays: [1, 4],
    });
  });

  it('maps the daily limit', async () => {
    result = { data: null, error: { code: '42501', message: 'limit_reached' } };
    expect(await createActivity(draft)).toEqual({ ok: false, error: 'limit_reached' });
  });

  it('maps other 42501 to not_allowed', async () => {
    result = { data: null, error: { code: '42501', message: 'collectif not linkable' } };
    expect(await createActivity(draft)).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('maps a thrown fetch failure to network', async () => {
    mockGetSession.mockRejectedValue(new Error('boom'));
    expect(await createActivity(draft)).toEqual({ ok: false, error: 'network' });
  });

  it.each([1, 61])('rejects %i days without calling the database', async (days) => {
    expect(await createActivity({ ...draft, recurrence: { kind: 'every_n_days', days } })).toEqual({
      ok: false,
      error: 'unknown',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('accepts the 2 and 60 day bounds', async () => {
    result = { data: { id: 'a' }, error: null };
    for (const days of [2, 60]) {
      expect((await createActivity({ ...draft, recurrence: { kind: 'every_n_days', days } })).ok).toBe(true);
    }
  });

  it('refuses when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await createActivity(draft)).toEqual({ ok: false, error: 'not_allowed' });
  });
});

const sessionJson = {
  id: 's1',
  starts_at: '2026-10-27T18:00:00Z',
  place_label: 'Parc',
  is_discovery: true,
  status: 'scheduled',
  confirmed_count: 2,
  is_full: false,
  my_attendance: { status: 'confirmed', guest_count: 1 },
  attendees: [{ first_name: 'Léa', photo_url: null }],
};
const sessionInfo = {
  id: 's1',
  startsAt: '2026-10-27T18:00:00Z',
  placeLabel: 'Parc',
  isDiscovery: true,
  status: 'scheduled',
  confirmedCount: 2,
  isFull: false,
  myAttendance: { status: 'confirmed', guestCount: 1 },
  attendees: [{ firstName: 'Léa', photoUrl: null }],
};

describe('getActivity', () => {
  it('maps the page JSON to camelCase', async () => {
    mockRpc.mockResolvedValue({
      error: null,
      data: {
        id: 'a1', title: 'Pétanque', description: null,
        category: { id: 'c', slug: 'sport', name_fr: 'Sport', name_en: 'Sport', icon: 'dumbbell' },
        tags: [{ slug: 'x', label_fr: 'X', label_en: 'Y' }],
        organiser: { first_name: 'Ana', photo_url: null },
        organised_by: { kind: 'collectif', id: 'c1', name: 'Les Boulistes' },
        place_label: 'Parc', lon: 4.8, lat: 45.7,
        recurrence_kind: 'weekdays', recurrence_interval_days: null, recurrence_weekdays: [1, 4],
        start_date: '2026-10-27', start_time: '19:00:00', duration_minutes: 120, timezone: 'Europe/Paris',
        max_size: 10, newcomer_friendly: true, approval_mode: 'approval',
        published_at: '2026-10-01T00:00:00Z', archived_at: null,
        is_organiser: false, my_status: 'pending',
        next_sessions: [sessionJson],
        welcome_first_name: 'Zoé',
      },
    });
    const r = await getActivity('a1');
    expect(mockRpc).toHaveBeenCalledWith('get_activity', { p_id: 'a1' });
    expect(r).toEqual({
      ok: true,
      activity: {
        id: 'a1', title: 'Pétanque', description: null,
        category: { id: 'c', slug: 'sport', nameFr: 'Sport', nameEn: 'Sport', icon: 'dumbbell' },
        tags: [{ slug: 'x', labelFr: 'X', labelEn: 'Y' }],
        organiser: { firstName: 'Ana', photoUrl: null },
        organisedBy: { kind: 'collectif', id: 'c1', name: 'Les Boulistes' },
        placeLabel: 'Parc', lon: 4.8, lat: 45.7,
        recurrence: { kind: 'weekdays', weekdays: [1, 4] },
        startDate: '2026-10-27', startTime: '19:00:00', durationMinutes: 120, timezone: 'Europe/Paris',
        maxSize: 10, newcomerFriendly: true, approvalMode: 'approval',
        publishedAt: '2026-10-01T00:00:00Z', archivedAt: null,
        isOrganiser: false, myStatus: 'pending',
        nextSessions: [sessionInfo],
        welcomeFirstName: 'Zoé',
      },
    });
  });

  it('maps every recurrence kind and omits attendees when absent', async () => {
    const base = {
      id: 'a', title: 't', place_label: 'p', lon: 0, lat: 0, start_date: 'd', start_time: 't',
      duration_minutes: 60, timezone: 'Europe/Paris', approval_mode: 'open', published_at: 'x',
      is_organiser: false, my_status: 'none',
      next_sessions: [{ ...sessionJson, attendees: undefined, my_attendance: null }],
    };
    mockRpc.mockResolvedValueOnce({ error: null, data: { ...base, recurrence_kind: 'weekly' } });
    mockRpc.mockResolvedValueOnce({
      error: null,
      data: { ...base, recurrence_kind: 'every_n_days', recurrence_interval_days: 5 },
    });
    const a: any = await getActivity('a');
    const b: any = await getActivity('a');
    expect(a.activity.recurrence).toEqual({ kind: 'weekly' });
    expect(b.activity.recurrence).toEqual({ kind: 'every_n_days', days: 5 });
    expect(a.activity.nextSessions[0].attendees).toBeUndefined();
    expect(a.activity.nextSessions[0].myAttendance).toBeNull();
    expect(a.activity.welcomeFirstName).toBeUndefined();
    expect(a.activity.organisedBy).toBeNull();
  });

  it('returns a null activity when not visible', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await getActivity('zz')).toEqual({ ok: true, activity: null });
  });

  it('maps a failed fetch', async () => {
    mockRpc.mockRejectedValue(new TypeError('Network request failed'));
    expect(await getActivity('a')).toEqual({ ok: false, error: 'network' });
  });
});

describe('myActivities', () => {
  it('maps the list', async () => {
    mockRpc.mockResolvedValue({
      error: null,
      data: [
        { id: 'a1', title: 'T', place_label: 'P', category_icon: 'x', is_organiser: true, my_status: 'member', next_session: sessionJson },
        { id: 'a2', title: 'U', place_label: 'Q', category_icon: 'y', is_organiser: false, my_status: 'pending', next_session: null },
      ],
    });
    const r: any = await myActivities();
    expect(mockRpc).toHaveBeenCalledWith('my_activities');
    expect(r.activities).toEqual([
      { id: 'a1', title: 'T', placeLabel: 'P', categoryIcon: 'x', isOrganiser: true, myStatus: 'member', nextSession: sessionInfo },
      { id: 'a2', title: 'U', placeLabel: 'Q', categoryIcon: 'y', isOrganiser: false, myStatus: 'pending', nextSession: null },
    ]);
  });
});

describe('join / leave', () => {
  it('joins and reports the resulting status', async () => {
    result = { data: { status: 'pending' }, error: null };
    expect(await joinActivity('a1')).toEqual({ ok: true, status: 'pending' });
    expect(mockFrom).toHaveBeenCalledWith('activity_members');
    expect(lastCall('insert')?.args[0]).toEqual({ activity_id: 'a1', user_id: 'me' });
  });
  it('maps rejoining after removal or a double tap (unique violation) to not_allowed', async () => {
    result = { data: null, error: { code: '23505', message: 'duplicate key value' } };
    expect(await joinActivity('a1')).toEqual({ ok: false, error: 'not_allowed' });
    expect(await joinActivity('a1')).toEqual({ ok: false, error: 'not_allowed' });
  });
  it('leaves', async () => {
    expect(await leaveActivity('a1')).toEqual({ ok: true });
    expect(lastCall('delete')).toBeDefined();
    expect(eqs()).toEqual([['activity_id', 'a1'], ['user_id', 'me']]);
  });
});

describe('setAttendance', () => {
  it('upserts the attendance with guest count', async () => {
    expect(await setAttendance('s1', 'confirmed', 1)).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('attendances');
    expect(lastCall('upsert')?.args).toEqual([
      { session_id: 's1', user_id: 'me', status: 'confirmed', guest_count: 1 },
      { onConflict: 'session_id,user_id' },
    ]);
  });
  it('maps session_full', async () => {
    result = { data: null, error: { code: 'P0001', message: 'session_full' } };
    expect(await setAttendance('s1', 'confirmed', 0)).toEqual({ ok: false, error: 'session_full' });
  });
});

describe('updateSession', () => {
  it('sends only the given fields, the place as a point', async () => {
    await updateSession('s1', {
      startsAt: '2026-11-03T18:00:00Z',
      place: { lon: 1, lat: 2 },
      placeLabel: 'Salle',
      isDiscovery: true,
      status: 'cancelled_by_organiser',
    });
    expect(lastCall('update')?.args[0]).toEqual({
      starts_at: '2026-11-03T18:00:00Z',
      place: 'SRID=4326;POINT(1 2)',
      place_label: 'Salle',
      is_discovery: true,
      status: 'cancelled_by_organiser',
    });
    await updateSession('s1', { isDiscovery: false });
    expect(lastCall('update')?.args[0]).toEqual({ is_discovery: false });
  });
});

describe('decideJoinRequest / setWelcomeMember', () => {
  it('accepts or declines through the membership status', async () => {
    await decideJoinRequest('a1', 'u2', true);
    expect(lastCall('update')?.args[0]).toEqual({ status: 'member' });
    await decideJoinRequest('a1', 'u2', false);
    expect(lastCall('update')?.args[0]).toEqual({ status: 'removed' });
    expect(mockFrom).toHaveBeenCalledWith('activity_members');
  });
  it('sets and clears the welcome member', async () => {
    await setWelcomeMember('a1', 'u2');
    expect(lastCall('update')?.args[0]).toEqual({ welcome_member_id: 'u2' });
    await setWelcomeMember('a1', null);
    expect(lastCall('update')?.args[0]).toEqual({ welcome_member_id: null });
  });
});

describe('collectifs', () => {
  it('creates with a point the database snaps', async () => {
    result = { data: { id: 'c1' }, error: null };
    const r = await createCollectif({
      name: 'Les Boulistes',
      description: 'x',
      town: { label: 'Lyon', lon: 4.83, lat: 45.76 },
    });
    expect(r).toEqual({ ok: true, id: 'c1' });
    expect(lastCall('insert')?.args[0]).toEqual({
      name: 'Les Boulistes',
      description: 'x',
      town_label: 'Lyon',
      town_point: 'SRID=4326;POINT(4.83 45.76)',
      created_by: 'me',
    });
  });
  it('maps the collectif limit', async () => {
    result = { data: null, error: { code: '42501', message: 'limit_reached' } };
    expect(
      await createCollectif({ name: 'abc', description: '', town: { label: 'L', lon: 0, lat: 0 } }),
    ).toEqual({ ok: false, error: 'limit_reached' });
  });
  it('reads a collectif page', async () => {
    mockRpc.mockResolvedValue({
      error: null,
      data: {
        id: 'c1', name: 'N', description: null, town_label: 'Lyon', lon: 4.8, lat: 45.7,
        organisers: [{ first_name: 'Ana', photo_url: null, role: 'responsable' }],
        activities: [{ id: 'a1', title: 'T', next_starts_at: null }],
        my_role: 'organiser',
      },
    });
    expect(await getCollectif('c1')).toEqual({
      ok: true,
      collectif: {
        id: 'c1', name: 'N', description: null, townLabel: 'Lyon', lon: 4.8, lat: 45.7,
        organisers: [{ firstName: 'Ana', photoUrl: null, role: 'responsable' }],
        activities: [{ id: 'a1', title: 'T', nextStartsAt: null }],
        myRole: 'organiser',
      },
    });
    mockRpc.mockResolvedValue({ error: null, data: null });
    expect(await getCollectif('zz')).toEqual({ ok: true, collectif: null });
  });
  it('lists mine, active members only', async () => {
    result = {
      data: [{ role: 'responsable', collectifs: { id: 'c1', name: 'N', town_label: 'Lyon' } }],
      error: null,
    };
    expect(await myCollectifs()).toEqual({
      ok: true,
      collectifs: [{ id: 'c1', name: 'N', townLabel: 'Lyon', role: 'responsable' }],
    });
    expect(mockFrom).toHaveBeenCalledWith('collectif_members');
    expect(eqs()).toEqual([['user_id', 'me'], ['status', 'active']]);
  });
  it('invites an organiser', async () => {
    await inviteOrganiser('c1', 'u2');
    expect(lastCall('insert')?.args[0]).toEqual({
      collectif_id: 'c1', user_id: 'u2', role: 'organiser', status: 'invited',
    });
  });
  it('accepts or declines an invitation', async () => {
    await answerInvitation('c1', true);
    expect(lastCall('update')?.args[0]).toEqual({ status: 'active' });
    calls.length = 0;
    await answerInvitation('c1', false);
    expect(lastCall('delete')).toBeDefined();
    expect(lastCall('update')).toBeUndefined();
  });
  it('leaves and deletes', async () => {
    await leaveCollectif('c1');
    expect(eqs()).toEqual([['collectif_id', 'c1'], ['user_id', 'me']]);
    calls.length = 0;
    await deleteCollectif('c1');
    expect(mockFrom).toHaveBeenLastCalledWith('collectifs');
    expect(eqs()).toEqual([['id', 'c1']]);
  });
});

describe('writes filtered out by row level security', () => {
  beforeEach(() => {
    result = { data: [], error: null };
  });
  const denied = { ok: false, error: 'not_allowed' };
  it('updateSession', async () => {
    expect(await updateSession('s1', { isDiscovery: true })).toEqual(denied);
  });
  it('decideJoinRequest', async () => {
    expect(await decideJoinRequest('a1', 'u2', true)).toEqual(denied);
    expect(await decideJoinRequest('a1', 'u2', false)).toEqual(denied);
  });
  it('setWelcomeMember', async () => {
    expect(await setWelcomeMember('a1', 'u2')).toEqual(denied);
  });
  it('deleteCollectif', async () => {
    expect(await deleteCollectif('c1')).toEqual(denied);
  });
  it('answerInvitation, accepting and declining', async () => {
    expect(await answerInvitation('c1', true)).toEqual(denied);
    expect(await answerInvitation('c1', false)).toEqual(denied);
  });
  it('ask for the affected rows', async () => {
    result = { data: [{}], error: null };
    await deleteCollectif('c1');
    expect(lastCall('select')).toBeDefined();
  });
});
