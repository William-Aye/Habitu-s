import {
  blockUser,
  deleteMessage,
  fetchMessages,
  markRead,
  myChats,
  reportMessage,
  sendMessage,
  setMuted,
  unreadTotal,
} from '../src/features/chat/api';

const mockRpc = jest.fn();
const mockGetSession = jest.fn();
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
const mockClient: any = {
  rpc(...a: unknown[]) {
    if (this !== mockClient) throw new TypeError('detached rpc');
    return mockRpc(...a);
  },
  from(...a: unknown[]) {
    if (this !== mockClient) throw new TypeError('detached from');
    return mockFrom(...a);
  },
  auth: {
    getSession(...a: unknown[]) {
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

beforeEach(() => {
  jest.resetAllMocks();
  calls.length = 0;
  result = { data: [{}], error: null };
  mockFrom.mockImplementation(() => builder);
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } } });
});

describe('fetchMessages', () => {
  it('calls chat_messages with the activity only by default', async () => {
    mockRpc.mockResolvedValue({ data: { archived: false, messages: [] }, error: null });
    const r = await fetchMessages('a1');
    expect(mockRpc).toHaveBeenCalledWith('chat_messages', { p_activity: 'a1' });
    expect(r).toEqual({
      ok: true,
      page: { archived: false, title: null, organiserId: null, muted: false, messages: [] },
    });
  });

  it('always sends both halves of the cursor and the limit', async () => {
    mockRpc.mockResolvedValue({ data: { archived: false, messages: [] }, error: null });
    await fetchMessages('a1', { before: { at: '2026-10-23T10:00:00Z', id: 'm9' }, limit: 50 });
    expect(mockRpc).toHaveBeenCalledWith('chat_messages', {
      p_activity: 'a1',
      p_before_at: '2026-10-23T10:00:00Z',
      p_before_id: 'm9',
      p_limit: 50,
    });
  });

  it('maps messages to camelCase', async () => {
    mockRpc.mockResolvedValue({
      data: {
        archived: true,
        title: 'Pétanque',
        organiser_id: 'org1',
        muted: true,
        messages: [
          {
            id: 'm1',
            body: 'Salut',
            created_at: '2026-10-23T10:00:00Z',
            sender: { id: 'u1', first_name: 'Léa', photo_url: null },
            is_mine: true,
          },
        ],
      },
      error: null,
    });
    const r = await fetchMessages('a1');
    expect(r).toEqual({
      ok: true,
      page: {
        archived: true,
        title: 'Pétanque',
        organiserId: 'org1',
        muted: true,
        messages: [
          {
            id: 'm1',
            body: 'Salut',
            createdAt: '2026-10-23T10:00:00Z',
            sender: { id: 'u1', firstName: 'Léa', photoUrl: null },
            isMine: true,
          },
        ],
      },
    });
  });

  it('is signed_out, without calling the server, when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await fetchMessages('a1')).toEqual({ ok: false, error: 'signed_out' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps a null result (not a member) to page null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchMessages('a1')).toEqual({ ok: true, page: null });
  });

  it('maps a thrown fetch to network', async () => {
    mockRpc.mockRejectedValue(new Error('Network request failed'));
    expect(await fetchMessages('a1')).toEqual({ ok: false, error: 'network' });
  });
});

describe('sendMessage', () => {
  it('inserts the message with the client id', async () => {
    result = { data: null, error: null };
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('messages');
    expect(lastCall('insert')?.args[0]).toEqual({ id: 'id1', activity_id: 'a1', body: 'Salut', sender_id: 'me' });
  });

  it('treats a duplicate id (23505) as sent', async () => {
    result = { data: null, error: { code: '23505', message: 'duplicate key' } };
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: true });
  });

  it('maps limit_reached', async () => {
    result = { data: null, error: { code: '42501', message: 'limit_reached' } };
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: false, error: 'limit_reached' });
  });

  it('maps another 42501 to not_allowed', async () => {
    result = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('returns signed_out, distinct from not_allowed, when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: false, error: 'signed_out' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns signed_out without inserting when the session user is someone else', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'B' } } } });
    expect(await sendMessage('A', 'a1', 'id1', 'Salut')).toEqual({ ok: false, error: 'signed_out' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('maps a network failure', async () => {
    mockFrom.mockImplementation(() => {
      throw new TypeError('Network request failed');
    });
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: false, error: 'network' });
  });

  it('maps unexpected errors to unknown', async () => {
    result = { data: null, error: { code: '22001', message: 'too long' } };
    expect(await sendMessage('me', 'a1', 'id1', 'Salut')).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('deleteMessage', () => {
  it('deletes by id and asks for the row', async () => {
    expect(await deleteMessage('m1')).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('messages');
    expect(calls.some((c) => c.method === 'delete')).toBe(true);
    expect(lastCall('eq')?.args).toEqual(['id', 'm1']);
    expect(calls.some((c) => c.method === 'select')).toBe(true);
  });

  it("maps someone else's message (no row) to not_allowed", async () => {
    result = { data: [], error: null };
    expect(await deleteMessage('m1')).toEqual({ ok: false, error: 'not_allowed' });
  });
});

describe('myChats', () => {
  it('maps the summaries', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          activity_id: 'a1',
          title: 'Pétanque',
          last_message: { body: 'Ok', created_at: '2026-10-23T10:00:00Z', sender_first_name: 'Léa', is_mine: true },
          unread_count: 3,
          muted: true,
        },
        { activity_id: 'a2', title: 'Yoga', last_message: null, unread_count: 0, muted: false },
      ],
      error: null,
    });
    const r = await myChats();
    expect(mockRpc).toHaveBeenCalledWith('my_chats');
    expect(r).toEqual({
      ok: true,
      chats: [
        {
          activityId: 'a1',
          title: 'Pétanque',
          lastMessage: { body: 'Ok', createdAt: '2026-10-23T10:00:00Z', senderFirstName: 'Léa', isMine: true },
          unreadCount: 3,
          muted: true,
        },
        { activityId: 'a2', title: 'Yoga', lastMessage: null, unreadCount: 0, muted: false },
      ],
    });
  });
});

describe('myChats and unreadTotal without a session', () => {
  it('myChats is signed_out, without calling the server', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await myChats()).toEqual({ ok: false, error: 'signed_out' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('unreadTotal calls my_unread_total', async () => {
    mockRpc.mockResolvedValue({ data: 12, error: null });
    expect(await unreadTotal()).toEqual({ ok: true, total: 12 });
    expect(mockRpc).toHaveBeenCalledWith('my_unread_total');
  });

  it('unreadTotal is signed_out when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await unreadTotal()).toEqual({ ok: false, error: 'signed_out' });
  });
});

describe('markRead and setMuted', () => {
  it('markRead calls mark_chat_read', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await markRead('a1')).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('mark_chat_read', { p_activity: 'a1' });
  });

  it('setMuted calls set_chat_muted', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await setMuted('a1', true)).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('set_chat_muted', { p_activity: 'a1', p_muted: true });
  });

  it('maps a refusal', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not_allowed' } });
    expect(await markRead('a1')).toEqual({ ok: false, error: 'not_allowed' });
  });
});

describe('reportMessage and blockUser', () => {
  it('reports a message on the existing reports table', async () => {
    result = { data: null, error: null };
    expect(await reportMessage('m1', 'harassment')).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('reports');
    expect(lastCall('insert')?.args[0]).toEqual({
      reporter_id: 'me',
      target_type: 'message',
      target_id: 'm1',
      reason: 'inappropriate_behaviour',
      details: 'harassment',
    });
  });

  it.each([
    ['inappropriate', 'inappropriate_behaviour'],
    ['scam', 'fake_or_spam'],
    ['other', 'other'],
  ] as const)('maps the %s reason to %s', async (reason, column) => {
    result = { data: null, error: null };
    await reportMessage('m1', reason);
    expect((lastCall('insert')?.args[0] as any).reason).toBe(column);
  });

  it('blocks a user as the signed-in user', async () => {
    result = { data: null, error: null };
    expect(await blockUser('u2')).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('blocks');
    expect(lastCall('upsert')?.args).toEqual([
      { blocker_id: 'me', blocked_id: 'u2' },
      { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
    ]);
  });

  it('is signed_out when signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await blockUser('u2')).toEqual({ ok: false, error: 'signed_out' });
    expect(await reportMessage('m1', 'other')).toEqual({ ok: false, error: 'signed_out' });
  });
});
