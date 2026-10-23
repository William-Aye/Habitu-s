import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSend = jest.fn();
jest.mock('../src/features/chat/api', () => ({
  sendMessage: (...a: unknown[]) => mockSend(...a),
}));
const mockGetSession = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}));

type Outbox = typeof import('../src/features/chat/outbox');

// Each load() is a fresh app start: new module state, but the same device storage.
let appStateListeners: ((s: string) => void)[] = [];
let inner: { netinfo: any; appState: any } = { netinfo: null, appState: null };
function load(init = false): Outbox {
  let mod!: Outbox;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: AsyncStorage }));
    mod = require('../src/features/chat/outbox');
    const { AppState } = require('react-native');
    appStateListeners = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, l: (s: string) => void) => {
      appStateListeners.push(l);
      return { remove() {} };
    }) as any);
    inner = { netinfo: require('@react-native-community/netinfo').default, appState: AppState };
  });
  if (init) mod.initOutbox();
  return mod;
}
const netinfo = () => inner.netinfo;
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};
const stored = async () => JSON.parse((await AsyncStorage.getItem('chat.outbox.v2'))!);
const U = 'u1';
const asUser = (id: string | null) =>
  mockGetSession.mockResolvedValue({ data: { session: id ? { user: { id } } : null } });

beforeEach(async () => {
  jest.useRealTimers();
  mockSend.mockReset(); // not resetAllMocks: it would wipe the AsyncStorage mock implementation
  mockGetSession.mockReset();
  asUser(U);
  await AsyncStorage.clear();
  mockSend.mockResolvedValue({ ok: true });
});

describe('enqueue', () => {
  it('trims, queues and persists under the v2 key', async () => {
    mockSend.mockReturnValue(new Promise(() => {})); // stays in flight
    const ob = load();
    await ob.ready();
    const m = ob.enqueue(U, 'a1', '  Salut  ')!;
    expect(m).toMatchObject({ userId: U, activityId: 'a1', body: 'Salut', state: 'sending', attempts: 0 });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ob.pending('a1', U)).toHaveLength(1);
    await settle();
    expect(await stored()).toHaveLength(1);
  });

  it('refuses whitespace only and over 2000 characters', async () => {
    mockSend.mockReturnValue(new Promise(() => {}));
    const ob = load();
    await ob.ready();
    expect(ob.enqueue(U, 'a1', '   \n ')).toBeNull();
    expect(ob.enqueue(U, 'a1', 'x'.repeat(2001))).toBeNull();
    expect(ob.enqueue(U, 'a1', 'x'.repeat(2000))).not.toBeNull();
  });

  it('restores the queue after a restart and sends it', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const first = load();
    await first.ready();
    const m = first.enqueue(U, 'a1', 'Salut')!;
    await settle();
    const second = load();
    await second.ready();
    await settle();
    expect(second.pending('a1', U).map((p) => p.id)).toEqual([m.id]);
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await second.flush();
    expect(mockSend).toHaveBeenLastCalledWith(U, 'a1', m.id, 'Salut');
    expect(second.pending('a1', U)).toEqual([]);
  });

  it('filters pending by user', async () => {
    mockSend.mockReturnValue(new Promise(() => {}));
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    expect(ob.pending('a1', 'someone-else')).toEqual([]);
  });
});

describe('flush', () => {
  it('sends in creation order and removes sent messages', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    const a = ob.enqueue(U, 'a1', 'un')!;
    const b = ob.enqueue(U, 'a1', 'deux')!;
    await settle();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await ob.flush();
    expect(mockSend.mock.calls.map((c) => c[2])).toEqual([a.id, b.id]);
    expect(ob.pending('a1', U)).toEqual([]);
  });

  it('keeps a message sending while offline and flushes on NetInfo connected', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load(true);
    await ob.ready();
    const m = ob.enqueue(U, 'a1', 'Salut')!;
    await settle();
    expect(ob.pending('a1', U)[0]).toMatchObject({ id: m.id, state: 'sending', attempts: 1 });
    mockSend.mockResolvedValue({ ok: true });
    netinfo().__emit({ isConnected: true });
    await settle();
    expect(ob.pending('a1', U)).toEqual([]);
  });

  it('continues after a failure and marks not_allowed as failed without retrying', async () => {
    const ob = load();
    await ob.ready();
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const a = ob.enqueue(U, 'a1', 'un')!;
    ob.enqueue(U, 'a1', 'deux');
    await settle();
    mockSend.mockReset();
    mockSend.mockImplementation(async (_u: string, _a: string, id: string) =>
      id === a.id ? { ok: false, error: 'not_allowed' } : { ok: true },
    );
    await ob.flush();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(ob.pending('a1', U)).toEqual([expect.objectContaining({ id: a.id, state: 'failed', error: 'not_allowed' })]);
    mockSend.mockClear();
    await ob.flush();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each(['limit_reached', 'unknown'] as const)('marks %s as failed', async (error) => {
    mockSend.mockResolvedValue({ ok: false, error });
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await settle();
    expect(ob.pending('a1', U)[0]).toMatchObject({ state: 'failed', error });
  });

  it('sends each message once when flush runs twice at the same time', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'un');
    ob.enqueue(U, 'a1', 'deux');
    await settle();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await Promise.all([ob.flush(), ob.flush()]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('runs once more when a reconnect arrives in the middle of a run', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load(true);
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await settle();
    mockSend.mockReset();
    let release!: (v: unknown) => void;
    mockSend.mockReturnValueOnce(new Promise((r) => (release = r)));
    mockSend.mockResolvedValue({ ok: true });
    const run = ob.flush();
    await settle();
    expect(mockSend).toHaveBeenCalledTimes(1); // in flight, offline
    netinfo().__emit({ isConnected: true }); // back online mid-run
    release({ ok: false, error: 'network' });
    await run;
    await settle();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(ob.pending('a1', U)).toEqual([]);
  });
});

describe('accounts', () => {
  it('does not send one account queue as another account, and deletes it', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    ob.enqueue('A', 'a1', 'Salut');
    await settle();
    asUser('B');
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await ob.flush();
    expect(mockSend).not.toHaveBeenCalled();
    // A's messages can never be sent from this session: they are not kept around.
    expect(ob.pending('a1', 'A')).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it('keeps the queue when there is no session at all', async () => {
    asUser('A');
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    ob.enqueue('A', 'a1', 'Salut');
    await settle();
    asUser(null);
    await ob.flush();
    expect(ob.pending('a1', 'A')).toHaveLength(1);
  });

  it('only retries on a timer for the current user', async () => {
    jest.useFakeTimers();
    try {
      mockSend.mockResolvedValue({ ok: false, error: 'network' });
      const ob = load(true);
      await ob.ready();
      ob.enqueue('A', 'a1', 'Salut');
      await jest.advanceTimersByTimeAsync(0);
      asUser('B');
      await jest.advanceTimersByTimeAsync(5000); // run as B: A's item is deleted
      mockSend.mockClear();
      await jest.advanceTimersByTimeAsync(300_000);
      expect(mockSend).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('leaves everything sending and sends nothing without a session', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await settle();
    asUser(null);
    mockSend.mockReset();
    await ob.flush();
    expect(mockSend).not.toHaveBeenCalled();
    expect(ob.pending('a1', U)[0]).toMatchObject({ state: 'sending' });
  });

  it('stops the run on signed_out and keeps every item sending', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'signed_out' });
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'un');
    ob.enqueue(U, 'a1', 'deux');
    await settle();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(ob.pending('a1', U).map((m) => [m.state, m.attempts])).toEqual([
      ['sending', 0],
      ['sending', 0],
    ]);
  });

  it('clearOutbox empties the queue and the stored copy', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await settle();
    await ob.clearOutbox();
    expect(ob.pending('a1', U)).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it('drops the v1 queue and items without a user on load', async () => {
    await AsyncStorage.setItem('chat.outbox.v1', JSON.stringify([{ id: 'x' }]));
    await AsyncStorage.setItem(
      'chat.outbox.v2',
      JSON.stringify([
        { id: 'old', activityId: 'a1', body: 'x', createdAt: 'now', state: 'sending', attempts: 0 },
        { id: 'ok', userId: U, activityId: 'a1', body: 'x', createdAt: 'now', state: 'failed', attempts: 1 },
      ]),
    );
    mockSend.mockReset();
    const ob = load();
    await ob.ready();
    expect(ob.pending('a1', U).map((m) => m.id)).toEqual(['ok']);
    expect(await AsyncStorage.getItem('chat.outbox.v1')).toBeNull();
  });
});

describe('corrupt storage', () => {
  it.each([['{not json'], ['[null, {}]'], ['"text"'], ['[1, "a", []]']])('survives %s', async (raw) => {
    await AsyncStorage.setItem('chat.outbox.v2', raw);
    const ob = load();
    await ob.ready();
    expect(ob.pending('a1', U)).toEqual([]);
    ob.enqueue(U, 'a1', 'Salut');
    await settle();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('resets the run guard even when sending throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));
    const ob = load();
    await ob.ready();
    ob.enqueue(U, 'a1', 'un');
    await settle();
    mockSend.mockResolvedValue({ ok: true });
    ob.enqueue(U, 'a1', 'deux');
    await settle();
    expect(mockSend).toHaveBeenCalledWith(U, 'a1', expect.any(String), 'deux');
  });
});

describe('retry, discard, subscribe', () => {
  it('retry resends a failed message', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'limit_reached' });
    const ob = load();
    await ob.ready();
    const m = ob.enqueue(U, 'a1', 'Salut')!;
    await settle();
    expect(ob.pending('a1', U)[0].state).toBe('failed');
    mockSend.mockResolvedValue({ ok: true });
    await ob.retry(m.id);
    expect(mockSend).toHaveBeenLastCalledWith(U, 'a1', m.id, 'Salut');
    expect(ob.pending('a1', U)).toEqual([]);
  });

  it('discard removes the message and persists', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'not_allowed' });
    const ob = load();
    await ob.ready();
    const m = ob.enqueue(U, 'a1', 'Salut')!;
    await settle();
    ob.discard(m.id);
    expect(ob.pending('a1', U)).toEqual([]);
    await settle();
    expect(await stored()).toEqual([]);
  });

  it('notifies subscribers until they unsubscribe', async () => {
    mockSend.mockReturnValue(new Promise(() => {}));
    const ob = load();
    await ob.ready();
    const l = jest.fn();
    const off = ob.subscribe(l);
    ob.enqueue(U, 'a1', 'Salut');
    expect(l).toHaveBeenCalled();
    l.mockClear();
    off();
    ob.enqueue(U, 'a1', 'Encore');
    expect(l).not.toHaveBeenCalled();
  });
});

describe('stalled and automatic retry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers(); // other loads of the module may still hold a retry timer
    jest.useRealTimers();
  });
  const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  it('is stalled after 3 attempts, or 2 minutes while still sending', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load(true);
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await tick(0);
    expect(ob.pending('a1', U)[0]).toMatchObject({ attempts: 1, stalled: false });
    await tick(5000); // 2nd attempt
    await tick(15000); // 3rd attempt
    expect(ob.pending('a1', U)[0]).toMatchObject({ attempts: 3, stalled: true });

    const other = load();
    await other.ready();
    await other.clearOutbox();
    other.enqueue(U, 'a2', 'Encore');
    await tick(0);
    expect(other.pending('a2', U)[0].stalled).toBe(false);
    await tick(121_000);
    expect(other.pending('a2', U)[0].stalled).toBe(true);
  });

  it('retries on a 5 s, 15 s, 60 s then 60 s backoff', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load(true);
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await tick(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
    await tick(4999);
    expect(mockSend).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
    await tick(15_000);
    expect(mockSend).toHaveBeenCalledTimes(3);
    await tick(59_999);
    expect(mockSend).toHaveBeenCalledTimes(3);
    await tick(1);
    expect(mockSend).toHaveBeenCalledTimes(4);
    await tick(60_000);
    expect(mockSend).toHaveBeenCalledTimes(5);
  });

  it('stops retrying in the background and when the queue is empty', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load(true);
    await ob.ready();
    ob.enqueue(U, 'a1', 'Salut');
    await tick(0);
    // Drive the app state through the listener the outbox registered.
    const listener = appStateListeners[0];
    expect(listener).toBeDefined();
    listener?.('background');
    await tick(120_000);
    expect(mockSend).toHaveBeenCalledTimes(1);
    mockSend.mockResolvedValue({ ok: true });
    listener?.('active'); // back in the foreground: flushes at once
    await tick(0);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(ob.pending('a1', U)).toEqual([]);
    await tick(120_000);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('initOutbox', () => {
  it('registers its listeners once, however often it is called', async () => {
    const ob = load();
    ob.initOutbox();
    ob.initOutbox();
    expect(netinfo().addEventListener).toHaveBeenCalledTimes(1);
  });

  it('does nothing at import time', async () => {
    mockSend.mockReset();
    await AsyncStorage.setItem(
      'chat.outbox.v2',
      JSON.stringify([{ id: 'k', userId: U, activityId: 'a1', body: 'x', createdAt: 'now', state: 'sending', attempts: 0 }]),
    );
    const ob = load();
    await ob.ready();
    await settle();
    expect(mockSend).not.toHaveBeenCalled();
    expect(netinfo().addEventListener).not.toHaveBeenCalled();
  });
});
