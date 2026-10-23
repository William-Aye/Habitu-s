import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSend = jest.fn();
jest.mock('../src/features/chat/api', () => ({
  sendMessage: (...a: unknown[]) => mockSend(...a),
}));

type Outbox = typeof import('../src/features/chat/outbox');

// Each load() is a fresh app start: new module state, but the same device storage.
let inner: { netinfo: any } = { netinfo: null };
function load(): Outbox {
  let mod!: Outbox;
  jest.isolateModules(() => {
    jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: AsyncStorage }));
    mod = require('../src/features/chat/outbox');
    inner = { netinfo: require('@react-native-community/netinfo').default };
  });
  return mod;
}
const netinfo = () => inner.netinfo;
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

beforeEach(async () => {
  mockSend.mockReset(); // not resetAllMocks: it would wipe the AsyncStorage mock implementation
  await AsyncStorage.clear();
  mockSend.mockResolvedValue({ ok: true });
});

describe('enqueue', () => {
  it('trims, queues and persists', async () => {
    mockSend.mockReturnValue(new Promise(() => {})); // stays in flight
    const ob = load();
    await ob.ready();
    const m = ob.enqueue('a1', '  Salut  ')!;
    expect(m).toMatchObject({ activityId: 'a1', body: 'Salut', state: 'sending' });
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ob.pending('a1')).toHaveLength(1);
    await settle();
    expect(JSON.parse((await AsyncStorage.getItem('chat.outbox.v1'))!)).toHaveLength(1);
  });

  it('refuses whitespace only and over 2000 characters', async () => {
    mockSend.mockReturnValue(new Promise(() => {}));
    const ob = load();
    await ob.ready();
    expect(ob.enqueue('a1', '   \n ')).toBeNull();
    expect(ob.enqueue('a1', 'x'.repeat(2001))).toBeNull();
    expect(ob.enqueue('a1', 'x'.repeat(2000))).not.toBeNull();
  });

  it('restores the queue after a restart and sends it', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const first = load();
    await first.ready();
    const m = first.enqueue('a1', 'Salut')!;
    await settle();
    const second = load();
    await second.ready();
    await settle();
    // The restored message is retried on start-up (still offline here), and kept.
    expect(second.pending('a1').map((p) => p.id)).toEqual([m.id]);
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await second.flush();
    expect(mockSend).toHaveBeenLastCalledWith('a1', m.id, 'Salut');
    expect(second.pending('a1')).toEqual([]);
  });
});

describe('flush', () => {
  it('sends in creation order and removes sent messages', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    const a = ob.enqueue('a1', 'un')!;
    const b = ob.enqueue('a1', 'deux')!;
    await settle();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await ob.flush();
    expect(mockSend.mock.calls.map((c) => c[1])).toEqual([a.id, b.id]);
    expect(ob.pending('a1')).toEqual([]);
  });

  it('keeps a message sending while offline and flushes on NetInfo connected', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    const m = ob.enqueue('a1', 'Salut')!;
    await settle();
    expect(ob.pending('a1')[0]).toMatchObject({ id: m.id, state: 'sending' });
    mockSend.mockResolvedValue({ ok: true });
    netinfo().__emit({ isConnected: true });
    await settle();
    await settle();
    expect(ob.pending('a1')).toEqual([]);
  });

  it('continues after a failure and marks not_allowed as failed without retrying', async () => {
    const ob = load();
    await ob.ready();
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const a = ob.enqueue('a1', 'un')!;
    ob.enqueue('a1', 'deux');
    await settle();
    mockSend.mockReset();
    mockSend.mockImplementation(async (_a: string, id: string) =>
      id === a.id ? { ok: false, error: 'not_allowed' } : { ok: true },
    );
    await ob.flush();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(ob.pending('a1')).toEqual([expect.objectContaining({ id: a.id, state: 'failed', error: 'not_allowed' })]);
    mockSend.mockClear();
    await ob.flush();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it.each(['limit_reached', 'unknown'] as const)('marks %s as failed', async (error) => {
    mockSend.mockResolvedValue({ ok: false, error });
    const ob = load();
    await ob.ready();
    ob.enqueue('a1', 'Salut');
    await settle();
    expect(ob.pending('a1')[0]).toMatchObject({ state: 'failed', error });
  });

  it('sends each message once when flush runs twice at the same time', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'network' });
    const ob = load();
    await ob.ready();
    ob.enqueue('a1', 'un');
    ob.enqueue('a1', 'deux');
    await settle();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    await Promise.all([ob.flush(), ob.flush()]);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('retry, discard, subscribe', () => {
  it('retry resends a failed message', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'limit_reached' });
    const ob = load();
    await ob.ready();
    const m = ob.enqueue('a1', 'Salut')!;
    await settle();
    expect(ob.pending('a1')[0].state).toBe('failed');
    mockSend.mockResolvedValue({ ok: true });
    await ob.retry(m.id);
    expect(mockSend).toHaveBeenLastCalledWith('a1', m.id, 'Salut');
    expect(ob.pending('a1')).toEqual([]);
  });

  it('discard removes the message and persists', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'not_allowed' });
    const ob = load();
    await ob.ready();
    const m = ob.enqueue('a1', 'Salut')!;
    await settle();
    ob.discard(m.id);
    expect(ob.pending('a1')).toEqual([]);
    await settle();
    expect(JSON.parse((await AsyncStorage.getItem('chat.outbox.v1'))!)).toEqual([]);
  });

  it('notifies subscribers until they unsubscribe', async () => {
    mockSend.mockReturnValue(new Promise(() => {}));
    const ob = load();
    await ob.ready();
    const l = jest.fn();
    const off = ob.subscribe(l);
    ob.enqueue('a1', 'Salut');
    expect(l).toHaveBeenCalled();
    l.mockClear();
    off();
    ob.enqueue('a1', 'Encore');
    expect(l).not.toHaveBeenCalled();
  });
});
