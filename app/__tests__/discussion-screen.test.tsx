import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useEffect as mockUseEffect } from 'react';
import { initI18n } from '../src/i18n';
import Discussion from '../src/app/discussions/[activityId]';
import { blockUser, deleteMessage, fetchMessages, markRead, myChats, reportMessage, sendMessage, setMuted } from '../src/features/chat/api';
import { clearOutbox, initOutbox } from '../src/features/chat/outbox';
import type { ChatMessage } from '../src/features/chat/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ activityId: 'act1' }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    mockUseEffect(cb, [cb]);
  },
}));
jest.mock('../src/features/chat/api', () => ({
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  deleteMessage: jest.fn(),
  markRead: jest.fn(),
  setMuted: jest.fn(),
  myChats: jest.fn(),
  reportMessage: jest.fn(),
  blockUser: jest.fn(),
}));
const mockHandlers: { filter: any; cb: (p: any) => void }[] = [];
const mockChannel: any = {};
mockChannel.on = jest.fn((_t: string, filter: any, cb: (p: any) => void) => {
  mockHandlers.push({ filter, cb });
  return mockChannel;
});
mockChannel.subscribe = jest.fn((cb?: (s: string) => void) => {
  cb?.('SUBSCRIBED');
  return mockChannel;
});
const mockRemoveChannel = jest.fn();
const mockChannelFactory = jest.fn((..._a: unknown[]) => mockChannel);
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    channel: (...a: unknown[]) => mockChannelFactory(...a),
    removeChannel: (...a: unknown[]) => mockRemoveChannel(...a),
  },
}));
const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));
let mockSession: { status: string; userId: string | null } = { status: 'ready', userId: 'me' };
jest.mock('../src/features/account/useSession', () => ({ useSession: () => mockSession }));

const mFetch = fetchMessages as jest.Mock;
const mSend = sendMessage as jest.Mock;
const ok = { ok: true };

const AT = (n: number) => `2026-10-23T10:${String(n).padStart(2, '0')}:00.123456+00:00`;
function msg(n: number, body: string, over: Partial<ChatMessage> = {}): ChatMessage {
  const mine = over.isMine ?? false;
  return {
    id: `m${n}`,
    body,
    createdAt: AT(n),
    sender: mine ? { id: 'me', firstName: 'Moi', photoUrl: null } : { id: 'u2', firstName: 'Camille', photoUrl: null },
    isMine: mine,
    ...over,
  };
}
const page = (messages: ChatMessage[], archived = false) => ({ ok: true, page: { archived, messages } });
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setImmediate(r));
    });
  }
};
async function open(messages: ChatMessage[], archived = false) {
  mFetch.mockResolvedValue(page(messages, archived));
  await render(<Discussion />);
  await settle();
}
const netinfo = () => require('@react-native-community/netinfo').default;
const emit = async (event: string, payload: any) => {
  const h = mockHandlers.find((x) => x.filter.event === event);
  await act(async () => h!.cb(payload));
  await settle();
};
const input = () => screen.getByPlaceholderText('Écrire un message…');
const sendBtn = () => screen.getByRole('button', { name: 'Envoyer' });

beforeAll(async () => {
  await initI18n();
  initOutbox();
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockHandlers.length = 0;
  mockSession = { status: 'ready', userId: 'me' };
  mockGate.mockResolvedValue(true);
  (markRead as jest.Mock).mockResolvedValue(ok);
  (setMuted as jest.Mock).mockResolvedValue(ok);
  (reportMessage as jest.Mock).mockResolvedValue(ok);
  (blockUser as jest.Mock).mockResolvedValue(ok);
  (deleteMessage as jest.Mock).mockResolvedValue(ok);
  (myChats as jest.Mock).mockResolvedValue({
    ok: true,
    chats: [{ activityId: 'act1', title: 'Jeux de société', lastMessage: null, unreadCount: 0, muted: false }],
  });
  mSend.mockReset();
  mSend.mockResolvedValue(ok);
  await clearOutbox();
});

describe('discussion screen', () => {
  it('shows messages with the sender first name, none on my own', async () => {
    await open([msg(2, 'Bonjour à tous', { isMine: true }), msg(1, 'Salut')]);
    expect(screen.getByText('Salut')).toBeTruthy();
    expect(screen.getByText('Camille')).toBeTruthy();
    expect(screen.getByText('Bonjour à tous')).toBeTruthy();
    expect(screen.queryByText('Moi')).toBeNull();
    expect(screen.getByText('Jeux de société')).toBeTruthy();
  });

  it('renders URLs as plain text', async () => {
    await open([msg(1, 'voir https://exemple.fr')]);
    expect(screen.getByText('voir https://exemple.fr')).toBeTruthy();
  });

  it('shows a sent message at once as sending, then as sent', async () => {
    await open([msg(1, 'Salut')]);
    let release!: (v: unknown) => void;
    mSend.mockImplementation(() => new Promise((r) => (release = r)));
    await fireEvent.changeText(input(), '  Coucou  ');
    await fireEvent.press(sendBtn());
    await settle();
    expect(screen.getByText('Coucou')).toBeTruthy();
    expect(screen.getByText('Envoi…')).toBeTruthy();
    expect(mSend).toHaveBeenCalledWith('me', 'act1', expect.any(String), 'Coucou');
    const sentId = mSend.mock.calls[0][2];
    mFetch.mockResolvedValue(page([msg(3, 'Coucou', { id: sentId, isMine: true }), msg(1, 'Salut')]));
    await act(async () => release(ok));
    await settle();
    expect(screen.getAllByText('Coucou')).toHaveLength(1);
    expect(screen.queryByText('Envoi…')).toBeNull();
  });

  it('keeps an offline send as sending and sends it on the NetInfo connect event', async () => {
    await open([]);
    mSend.mockResolvedValue({ ok: false, error: 'network' });
    await fireEvent.changeText(input(), 'Hors ligne');
    await fireEvent.press(sendBtn());
    await settle();
    expect(screen.getByText('Envoi…')).toBeTruthy();
    const before = mSend.mock.calls.length;
    mSend.mockResolvedValue(ok);
    await act(async () => netinfo().__emit({ isConnected: true }));
    await settle();
    expect(mSend.mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByText('Envoi…')).toBeNull();
  });

  it('on a realtime INSERT re-reads the latest page; the message shows once even if pending', async () => {
    await open([msg(1, 'Salut')]);
    mSend.mockResolvedValue({ ok: false, error: 'network' });
    await fireEvent.changeText(input(), 'Moi aussi');
    await fireEvent.press(sendBtn());
    await settle();
    const pendingId = mSend.mock.calls[0][2];
    mFetch.mockClear();
    mFetch.mockResolvedValue(
      page([msg(4, 'Moi aussi', { id: pendingId, isMine: true }), msg(3, 'Nouveau'), msg(1, 'Salut')]),
    );
    await emit('INSERT', { eventType: 'INSERT', new: { id: 'm3' } });
    expect(mFetch).toHaveBeenCalledTimes(1);
    expect(mFetch.mock.calls[0][1]?.before).toBeUndefined();
    expect(screen.getAllByText('Nouveau')).toHaveLength(1);
    expect(screen.getAllByText('Moi aussi')).toHaveLength(1);
    expect(screen.getAllByText('Salut')).toHaveLength(1);
    await emit('INSERT', { eventType: 'INSERT', new: { id: 'm3' } });
    expect(screen.getAllByText('Nouveau')).toHaveLength(1);
  });

  it('subscribes to INSERTs filtered by activity, DELETEs unfiltered', async () => {
    await open([msg(1, 'Salut')]);
    expect(mockChannelFactory).toHaveBeenCalledWith('chat:act1');
    const ins = mockHandlers.find((h) => h.filter.event === 'INSERT')!;
    const del = mockHandlers.find((h) => h.filter.event === 'DELETE')!;
    expect(ins.filter).toMatchObject({ schema: 'public', table: 'messages', filter: 'activity_id=eq.act1' });
    expect(del.filter.filter).toBeUndefined();
  });

  it('removes a bubble on DELETE only when its id is in the list', async () => {
    await open([msg(2, 'Deux'), msg(1, 'Un')]);
    await emit('DELETE', { eventType: 'DELETE', old: { id: 'zzz' } });
    expect(screen.getByText('Deux')).toBeTruthy();
    expect(screen.getByText('Un')).toBeTruthy();
    await emit('DELETE', { eventType: 'DELETE', old: { id: 'm2' } });
    expect(screen.queryByText('Deux')).toBeNull();
    expect(screen.getByText('Un')).toBeTruthy();
  });

  it('loads older messages with the raw cursor of the oldest message', async () => {
    const many = Array.from({ length: 50 }, (_, i) => msg(59 - i, `Msg ${59 - i}`));
    await open(many);
    mFetch.mockClear();
    mFetch.mockResolvedValue(page([msg(9, 'Ancien')]));
    await fireEvent(screen.getByTestId('chat-list'), 'endReached');
    await settle();
    expect(mFetch).toHaveBeenCalledWith('act1', expect.objectContaining({ before: { at: AT(10), id: 'm10' } }));
  });

  it('shows the join text and a way back for a non-member', async () => {
    mFetch.mockResolvedValue({ ok: true, page: null });
    await render(<Discussion />);
    await settle();
    expect(screen.getByText("Rejoignez l'activité pour participer à la discussion.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: "Voir l'activité" }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/activites/act1');
    expect(screen.queryByPlaceholderText('Écrire un message…')).toBeNull();
  });

  it('hides the composer when archived', async () => {
    await open([msg(1, 'Salut')], true);
    expect(screen.getByText('Cette activité est archivée : la discussion est en lecture seule.')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Écrire un message…')).toBeNull();
  });

  it('disables Envoyer while the text is empty and shows a counter after 1800', async () => {
    await open([]);
    expect(sendBtn().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(input(), '   ');
    expect(sendBtn().props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByText(/ \/ 2000/)).toBeNull();
    await fireEvent.changeText(input(), 'a'.repeat(1850));
    expect(screen.getByText('1850 / 2000')).toBeTruthy();
    expect(input().props.maxLength).toBe(2000);
    expect(sendBtn().props.accessibilityState?.disabled).toBe(false);
  });

  it('shows the limit message when a send hits limit_reached', async () => {
    await open([]);
    mSend.mockResolvedValue({ ok: false, error: 'limit_reached' });
    await fireEvent.changeText(input(), 'Trop');
    await fireEvent.press(sendBtn());
    await settle();
    expect(screen.getByText('Vous envoyez beaucoup de messages. Patientez une minute.')).toBeTruthy();
  });

  it('offers only deletion on my own message, with a confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open([msg(2, 'Le mien', { isMine: true }), msg(1, 'Salut')]);
    await fireEvent(screen.getByText('Le mien'), 'longPress');
    expect(screen.getByRole('button', { name: 'Supprimer le message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Signaler' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bloquer/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Supprimer le message' }));
    expect(alert).toHaveBeenCalledWith('Supprimer ce message pour tout le monde ?', undefined, expect.any(Array));
    expect(deleteMessage).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Supprimer le message')!.onPress!());
    await settle();
    expect(deleteMessage).toHaveBeenCalledWith('m2');
    expect(screen.queryByText('Le mien')).toBeNull();
    alert.mockRestore();
  });

  it("offers report and block on someone else's message; report sends the chosen reason", async () => {
    await open([msg(1, 'Salut')]);
    await fireEvent(screen.getByText('Salut'), 'longPress');
    expect(screen.queryByRole('button', { name: 'Supprimer le message' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bloquer Camille' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Signaler' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Harcèlement' }));
    await settle();
    expect(reportMessage).toHaveBeenCalledWith('m1', 'harassment');
  });

  it('blocks after a confirmation, then reloads the list', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open([msg(1, 'Salut')]);
    await fireEvent(screen.getByText('Salut'), 'longPress');
    await fireEvent.press(screen.getByRole('button', { name: 'Bloquer Camille' }));
    expect(blockUser).not.toHaveBeenCalled();
    mFetch.mockClear();
    mFetch.mockResolvedValue(page([]));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    await settle();
    expect(blockUser).toHaveBeenCalledWith('u2');
    expect(mFetch).toHaveBeenCalled();
    expect(screen.queryByText('Salut')).toBeNull();
    alert.mockRestore();
  });

  it('toggles mute through setMuted', async () => {
    await open([]);
    await fireEvent.press(screen.getByRole('button', { name: 'Couper les notifications' }));
    await settle();
    expect(setMuted).toHaveBeenCalledWith('act1', true);
    expect(screen.getByRole('button', { name: 'Réactiver les notifications' })).toBeTruthy();
  });

  it('marks the discussion read on open', async () => {
    await open([msg(1, 'Salut')]);
    expect(markRead).toHaveBeenCalledWith('act1');
  });

  it('removes the channel on unmount', async () => {
    await open([]);
    expect(mockRemoveChannel).not.toHaveBeenCalled();
    await screen.unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(mockChannel);
  });

  it('asks a signed-out visitor for an account first', async () => {
    mockSession = { status: 'signed_out', userId: null };
    mockGate.mockResolvedValue(false);
    await render(<Discussion />);
    await settle();
    expect(mockGate).toHaveBeenCalledWith('message');
    expect(mFetch).not.toHaveBeenCalled();
  });
});
