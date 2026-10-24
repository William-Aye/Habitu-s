import { block, listBlocked, unblock } from '../src/features/safety/blocks';
import { reportTarget } from '../src/features/safety/reports';

let calls: { method: string; args: unknown[] }[] = [];
let result: { data: unknown; error: { code?: string; message?: string } | null } = { data: null, error: null };
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetSession = jest.fn();
function mockBuilder(): any {
  const b: any = new Proxy(
    {},
    {
      get: (_t, method: string) => {
        if (method === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
        return (...args: unknown[]) => {
          calls.push({ method, args });
          return b;
        };
      },
    },
  );
  return b;
}
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => {
      mockFrom(...a);
      return mockBuilder();
    },
    rpc: (...a: unknown[]) => mockRpc(...a),
    auth: { getSession: () => mockGetSession() },
  },
}));
const last = (m: string) => calls.filter((c) => c.method === m).at(-1);

beforeEach(() => {
  calls = [];
  jest.clearAllMocks();
  result = { data: null, error: null };
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
});

describe('reportTarget', () => {
  it('inserts on reports without sending a reporter or reading anything back', async () => {
    expect(await reportTarget('message', 'm1', 'harassment', 'x')).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(last('insert')?.args[0]).toEqual({
      target_type: 'message',
      target_id: 'm1',
      reason: 'harassment',
      details: 'x',
    });
    expect(last('select')).toBeUndefined();
  });

  it('sends null details when there are none', async () => {
    await reportTarget('user', 'u1', 'other');
    expect((last('insert')?.args[0] as any).details).toBeNull();
  });

  it.each([
    ['limit_reached', 'limit_reached'],
    ['not_allowed', 'not_allowed'],
  ])('maps a 42501 %s refusal', async (message, error) => {
    result = { data: null, error: { code: '42501', message } };
    expect(await reportTarget('user', 'u1', 'other')).toEqual({ ok: false, error });
  });

  it('is signed_out without a session, network on a thrown call, unknown otherwise', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await reportTarget('user', 'u1', 'other')).toEqual({ ok: false, error: 'signed_out' });
    expect(mockFrom).not.toHaveBeenCalled();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
    result = { data: null, error: { code: 'XX000', message: 'boom' } };
    expect(await reportTarget('user', 'u1', 'other')).toEqual({ ok: false, error: 'unknown' });
    mockGetSession.mockRejectedValue(new Error('offline'));
    expect(await reportTarget('user', 'u1', 'other')).toEqual({ ok: false, error: 'network' });
  });
});

describe('blocks', () => {
  it('blocks as the signed-in user', async () => {
    expect(await block('u2')).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('blocks');
    expect(last('upsert')?.args).toEqual([
      { blocker_id: 'me', blocked_id: 'u2' },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
    ]);
  });

  it('unblocks only my own block', async () => {
    expect(await unblock('u2')).toEqual({ ok: true });
    expect(last('delete')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['blocker_id', 'me'],
      ['blocked_id', 'u2'],
    ]);
  });

  it('lists the blocked people from my_blocked', async () => {
    mockRpc.mockResolvedValue({ data: [{ user_id: 'u1', first_name: 'Camille' }], error: null });
    expect(await listBlocked()).toEqual({ ok: true, blocked: [{ userId: 'u1', firstName: 'Camille' }] });
    expect(mockRpc).toHaveBeenCalledWith('my_blocked');
  });

  it('is signed_out when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await block('u2')).toEqual({ ok: false, error: 'signed_out' });
    expect(await unblock('u2')).toEqual({ ok: false, error: 'signed_out' });
  });
});
