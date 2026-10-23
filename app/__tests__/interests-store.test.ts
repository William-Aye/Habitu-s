import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getInterests,
  hasLocalInterests,
  mergeLocalIntoAccount,
  subscribeInterestsChanged,
  nextTapLevel,
  setLevel,
  type Level,
} from '../src/features/interests/store';

type Row = { user_id: string; category_id: string; level: string };
const db = { rows: [] as Row[], failUpsert: false, onUpsert: null as null | (() => Promise<void>) };

jest.mock('../src/lib/supabase', () => {
  const fake = {
    from: (table: string) => {
      if (table !== 'user_interests') throw new Error('unexpected table');
      return {
        select: () => ({
          eq: async (_c: string, userId: string) => ({
            data: db.rows.filter((r) => r.user_id === userId),
            error: null,
          }),
        }),
        upsert: async (input: Row | Row[]) => {
          if (db.failUpsert) return { error: { message: 'boom' } };
          const hook = db.onUpsert;
          await hook?.();
          for (const r of Array.isArray(input) ? input : [input]) {
            db.rows = db.rows.filter(
              (x) => !(x.user_id === r.user_id && x.category_id === r.category_id),
            );
            db.rows.push({ ...r });
          }
          return { error: null };
        },
        delete: () => ({
          eq: (_a: string, userId: string) => ({
            eq: async (_b: string, categoryId: string) => {
              db.rows = db.rows.filter(
                (x) => !(x.user_id === userId && x.category_id === categoryId),
              );
              return { error: null };
            },
          }),
        }),
      };
    },
  };
  return { supabase: fake };
});

const U = 'user-1';

beforeEach(async () => {
  db.rows = [];
  db.failUpsert = false;
  db.onUpsert = null;
  await AsyncStorage.clear();
});

it('signed-out setLevel writes interests.local and removes on null', async () => {
  await setLevel(null, 'a', 'like');
  expect(JSON.parse((await AsyncStorage.getItem('interests.local')) as string)).toEqual({ a: 'like' });
  expect(await getInterests(null)).toEqual({ a: 'like' });
  await setLevel(null, 'a', null);
  expect(await getInterests(null)).toEqual({});
});

it('signed-in setLevel writes the account rows', async () => {
  await setLevel(U, 'a', 'love');
  expect(await getInterests(U)).toEqual({ a: 'love' });
  await setLevel(U, 'a', null);
  expect(await getInterests(U)).toEqual({});
  expect(await AsyncStorage.getItem('interests.local')).toBeNull();
});

it('nextTapLevel cycles none > like > love > none and curious > like', () => {
  const table: [Level | null, Level | null][] = [
    [null, 'like'],
    ['like', 'love'],
    ['love', null],
    ['curious', 'like'],
  ];
  for (const [from, to] of table) expect(nextTapLevel(from)).toBe(to);
});

describe('mergeLocalIntoAccount', () => {
  const seed = async () => {
    await AsyncStorage.setItem(
      'interests.local',
      JSON.stringify({ a: 'love', b: 'like', c: 'curious' }),
    );
    db.rows = [
      { user_id: U, category_id: 'a', level: 'like' },
      { user_id: U, category_id: 'b', level: 'love' },
      { user_id: U, category_id: 'd', level: 'like' },
    ];
  };

  it('keeps the stronger level, adds local-only entries and clears the local key', async () => {
    await seed();
    await mergeLocalIntoAccount(U);
    expect(await getInterests(U)).toEqual({ a: 'love', b: 'love', c: 'curious', d: 'like' });
    expect(await AsyncStorage.getItem('interests.local')).toBeNull();
  });

  it('tells listeners to refresh even when the merge throws', async () => {
    await seed();
    db.failUpsert = true;
    const listener = jest.fn();
    const off = subscribeInterestsChanged(listener);
    await mergeLocalIntoAccount(U).catch(() => undefined);
    off();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hasLocalInterests reflects the local key', async () => {
    expect(await hasLocalInterests()).toBe(false);
    await AsyncStorage.setItem('interests.local', JSON.stringify({ a: 'like' }));
    expect(await hasLocalInterests()).toBe(true);
    await AsyncStorage.setItem('interests.local', '{}');
    expect(await hasLocalInterests()).toBe(false);
  });

  it('is idempotent', async () => {
    await seed();
    await mergeLocalIntoAccount(U);
    const once = await getInterests(U);
    await mergeLocalIntoAccount(U);
    expect(await getInterests(U)).toEqual(once);
  });

  it('keeps interests.local when the upsert fails, without leaking data in the error', async () => {
    await seed();
    db.failUpsert = true;
    const err = await mergeLocalIntoAccount(U).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/user-1|love|like|curious/);
    expect(JSON.parse((await AsyncStorage.getItem('interests.local')) as string)).toEqual({
      a: 'love',
      b: 'like',
      c: 'curious',
    });
  });

  it('keeps an entry changed during the upload and removes the unchanged merged ones', async () => {
    await AsyncStorage.setItem('interests.local', JSON.stringify({ a: 'like', b: 'curious' }));
    // b is tapped again during each of the two bounded passes: it must stay local, a must go.
    const taps: Level[] = ['love', 'like'];
    db.onUpsert = () => setLevel(null, 'b', taps.shift() ?? 'like');
    await mergeLocalIntoAccount(U);
    expect(await getInterests(null)).toEqual({ b: 'like' });
    expect(await getInterests(U)).toEqual({ a: 'like', b: 'love' });
  });

  it('merges a tap made during the upload in one extra pass', async () => {
    await AsyncStorage.setItem('interests.local', JSON.stringify({ a: 'like' }));
    let fired = false;
    db.onUpsert = async () => {
      if (!fired) await setLevel(null, 'z', 'love');
      fired = true;
    };
    await mergeLocalIntoAccount(U);
    expect(await getInterests(U)).toEqual({ a: 'like', z: 'love' });
    expect(await AsyncStorage.getItem('interests.local')).toBeNull();
  });

  it('applies a deletion made during the upload to the account', async () => {
    await AsyncStorage.setItem('interests.local', JSON.stringify({ a: 'like', b: 'love' }));
    let fired = false;
    db.onUpsert = async () => {
      if (!fired) await setLevel(null, 'b', null);
      fired = true;
    };
    await mergeLocalIntoAccount(U);
    expect(await getInterests(U)).toEqual({ a: 'like' });
    expect(await AsyncStorage.getItem('interests.local')).toBeNull();
  });
});
