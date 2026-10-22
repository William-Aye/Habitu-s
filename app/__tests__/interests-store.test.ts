import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getInterests,
  mergeLocalIntoAccount,
  nextTapLevel,
  setLevel,
  type Level,
} from '../src/features/interests/store';

type Row = { user_id: string; category_id: string; level: string };
const db = { rows: [] as Row[], failUpsert: false };

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
});
