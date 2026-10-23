import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { useEffect as mockUseEffect } from 'react';
import { initI18n } from '../src/i18n';
import Discussion from '../src/app/discussions/[activityId]';
import { deleteMessage, fetchMessages, markRead, sendMessage, setMuted } from '../src/features/chat/api';
import { block as blockUser } from '../src/features/safety/blocks';
import { reportTarget } from '../src/features/safety/reports';
import { onUnreadChanged } from '../src/features/chat/unreadEvents';
import { clearOutbox, initOutbox } from '../src/features/chat/outbox';
import type { ChatMessage } from '../src/features/chat/types';

let mockBottomInset = 0;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: mockBottomInset, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
let mockActivityId = 'act1';
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ activityId: mockActivityId }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    mockUseEffect(() => {
      mockFocusCb = cb;
      mockFocusCleanup = cb();
      return () => mockFocusCleanup?.();
    }, [cb]);
  },
}));
let mockFocusCb: (() => void | (() => void)) | null = null;
let mockFocusCleanup: void | (() => void);
const blurScreen = async () => {
  await act(async () => {
    mockFocusCleanup?.();
    mockFocusCleanup = undefined;
  });
  await settle();
};
const focusScreen = async () => {
  await act(async () => {
    mockFocusCleanup = mockFocusCb!();
  });
  await settle();
};
let mockAppHandlers: ((s: string) => void)[] = [];
const setAppState = async (s: string) => {
  await act(async () => mockAppHandlers.forEach((h) => h(s)));
  await settle();
};
jest.mock('../src/features/chat/api', () => ({
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  deleteMessage: jest.fn(),
  markRead: jest.fn(),
  setMuted: jest.fn(),
}));
jest.mock('../src/features/safety/reports', () => ({ reportTarget: jest.fn() }));
jest.mock('../src/features/safety/blocks', () => ({ block: jest.fn() }));
const mockHandlers: { filter: any; cb: (p: any) => void }[] = [];
// Like realtime-js: the same topic returns the same channel, and callbacks cannot be added once subscribed.
const mockChannels = new Map<string, any>();
function mockMakeChannel(topic: string) {
  let c = mockChannels.get(topic);
  if (!c) {
    c = { subscribed: false };
    c.on = jest.fn((_t: string, filter: any, cb: (p: any) => void) => {
      if (c.subscribed) throw new Error('cannot add postgres_changes callbacks after subscribe()');
      mockHandlers.push({ filter, cb });
      return c;
    });
    c.subscribe = jest.fn((cb?: (s: string) => void) => {
      c.subscribed = true;
      cb?.('SUBSCRIBED');
      return c;
    });
    mockChannels.set(topic, c);
  }
  return c;
}
const mockRemoveChannel = jest.fn();
const mockChannelFactory = jest.fn((topic: string) => mockMakeChannel(topic));
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    channel: (topic: string) => mockChannelFactory(topic),
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
const page = (messages: ChatMessage[], archived = false, over = {}) => ({
  ok: true,
  page: { archived, title: 'Jeux de société', organiserId: 'org', muted: false, messages, ...over },
});
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
  mockChannels.clear();
  mockActivityId = 'act1';
  mockSession = { status: 'ready', userId: 'me' };
  mockGate.mockResolvedValue(true);
  mockBottomInset = 0;
  mockFocusCb = null;
  mockFocusCleanup = undefined;
  mockAppHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    mockAppHandlers.push(h);
    return { remove: jest.fn() };
  }) as never);
  (markRead as jest.Mock).mockResolvedValue(ok);
  (setMuted as jest.Mock).mockResolvedValue(ok);
  (reportTarget as jest.Mock).mockResolvedValue(ok);
  (blockUser as jest.Mock).mockResolvedValue(ok);
  (deleteMessage as jest.Mock).mockResolvedValue(ok);
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
    expect(screen.getByLabelText('Messages de la discussion')).toBeTruthy();
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

  it('subscribes to INSERTs filtered by activity and not to DELETEs', async () => {
    await open([msg(1, 'Salut')]);
    expect(mockChannelFactory).toHaveBeenCalledWith(expect.stringMatching(/^chat:act1:.+/));
    const ins = mockHandlers.find((h) => h.filter.event === 'INSERT')!;
    expect(ins.filter).toMatchObject({ schema: 'public', table: 'messages', filter: 'activity_id=eq.act1' });
    expect(mockHandlers.some((h) => h.filter.event === 'DELETE')).toBe(false);
    expect(mockHandlers).toHaveLength(1);
  });

  it("drops someone else's deleted message on the next INSERT signal re-read", async () => {
    await open([msg(2, 'Deux'), msg(1, 'Un')]);
    mFetch.mockResolvedValue(page([msg(3, 'Trois'), msg(1, 'Un')]));
    await emit('INSERT', { eventType: 'INSERT', new: { id: 'm3' } });
    expect(screen.queryByText('Deux')).toBeNull();
    expect(screen.getByText('Trois')).toBeTruthy();
    expect(screen.getByText('Un')).toBeTruthy();
  });

  it("drops someone else's deleted message when the screen gets focus back", async () => {
    await open([msg(2, 'Deux'), msg(1, 'Un')]);
    await blurScreen();
    mFetch.mockClear();
    mFetch.mockResolvedValue(page([msg(1, 'Un')]));
    await focusScreen();
    expect(mFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Deux')).toBeNull();
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
    await fireEvent.press(await screen.findByRole('radio', { name: 'Harcèlement' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Envoyer le signalement' }));
    await settle();
    expect(reportTarget).toHaveBeenCalledWith('message', 'm1', 'harassment', undefined);
    expect(screen.getByText('Merci, votre signalement a été envoyé.')).toBeTruthy();
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
    expect(mockRemoveChannel).toHaveBeenCalledWith(expect.objectContaining({ subscribed: true }));
  });

  it('asks a signed-out visitor for an account first', async () => {
    mockSession = { status: 'signed_out', userId: null };
    mockGate.mockResolvedValue(false);
    await render(<Discussion />);
    await settle();
    expect(mockGate).toHaveBeenCalledWith('message');
    expect(mFetch).not.toHaveBeenCalled();
  });

  it('survives a quick remount: each mount subscribes on its own topic', async () => {
    await open([msg(1, 'Salut')]);
    await screen.unmount();
    await open([msg(1, 'Salut')]);
    const topics = mockChannelFactory.mock.calls.map((c) => c[0]);
    expect(topics).toHaveLength(2);
    expect(new Set(topics).size).toBe(2);
    expect(screen.getByText('Salut')).toBeTruthy();
  });

  it('shows an error screen with a retry when the first load fails', async () => {
    mFetch.mockResolvedValue({ ok: false, error: 'network' });
    await render(<Discussion />);
    await settle();
    expect(screen.getByText('Impossible de charger la discussion. Réessayez.')).toBeTruthy();
    mFetch.mockResolvedValue(page([msg(1, 'Salut')]));
    await fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
    await settle();
    expect(screen.getByText('Salut')).toBeTruthy();
  });

  it('keeps the list and shows a notice when a later re-read fails, then clears it', async () => {
    await open([msg(1, 'Salut')]);
    mFetch.mockResolvedValue({ ok: false, error: 'network' });
    await emit('INSERT', { eventType: 'INSERT', new: { id: 'm2' } });
    expect(screen.getByText('Salut')).toBeTruthy();
    expect(screen.getByText('Impossible de mettre à jour la discussion. Réessayez.')).toBeTruthy();
    mFetch.mockResolvedValue(page([msg(2, 'Suite'), msg(1, 'Salut')]));
    await emit('INSERT', { eventType: 'INSERT', new: { id: 'm2' } });
    expect(screen.queryByText('Impossible de mettre à jour la discussion. Réessayez.')).toBeNull();
  });

  it('keeps the list and shows a notice when loading older messages fails', async () => {
    const many = Array.from({ length: 50 }, (_, i) => msg(59 - i, `Msg ${59 - i}`));
    await open(many);
    mFetch.mockResolvedValue({ ok: false, error: 'network' });
    await fireEvent(screen.getByTestId('chat-list'), 'endReached');
    await settle();
    expect(screen.getByText('Impossible de mettre à jour la discussion. Réessayez.')).toBeTruthy();
    expect(screen.getByText('Msg 59')).toBeTruthy();
  });

  it('asks for an account on signed_out instead of showing the error screen', async () => {
    mFetch.mockResolvedValueOnce({ ok: false, error: 'signed_out' });
    mFetch.mockResolvedValue(page([msg(1, 'Salut')]));
    await render(<Discussion />);
    await settle();
    expect(mockGate).toHaveBeenCalledWith('message');
    expect(screen.queryByText('Impossible de charger la discussion. Réessayez.')).toBeNull();
    expect(screen.getByText('Salut')).toBeTruthy();
  });

  it('reverts the mute toggle and shows a notice when it fails', async () => {
    await open([]);
    (setMuted as jest.Mock).mockResolvedValue({ ok: false, error: 'network' });
    await fireEvent.press(screen.getByRole('button', { name: 'Couper les notifications' }));
    await settle();
    expect(screen.getByRole('button', { name: 'Couper les notifications' })).toBeTruthy();
    expect(screen.getByText('Impossible de modifier les notifications. Réessayez.')).toBeTruthy();
  });

  it('keeps a sent bubble visible until the re-read that follows its send returns', async () => {
    await open([]);
    let release!: (v: unknown) => void;
    mSend.mockImplementation(() => new Promise((r) => (release = r)));
    await fireEvent.changeText(input(), 'Coucou');
    await fireEvent.press(sendBtn());
    await settle();
    const sentId = mSend.mock.calls[0][2];
    let resolveRead!: (v: unknown) => void;
    mFetch.mockImplementation(() => new Promise((r) => (resolveRead = r)));
    await act(async () => release(ok));
    await settle();
    expect(screen.getAllByText('Coucou')).toHaveLength(1); // read still in flight
    await act(async () => resolveRead(page([msg(3, 'Coucou', { id: sentId, isMine: true })])));
    await settle();
    expect(screen.getAllByText('Coucou')).toHaveLength(1);
  });

  it('ignores an in-flight read for a previous activity after the id changes', async () => {
    let resolveOld!: (v: unknown) => void;
    mFetch.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    const view = await render(<Discussion />);
    await settle();
    mockActivityId = 'act2';
    mFetch.mockResolvedValue(page([msg(5, 'Nouveau groupe')]));
    await view.rerender(<Discussion />);
    await settle();
    await act(async () => resolveOld(page([msg(1, 'Ancien groupe')])));
    await settle();
    expect(screen.getByText('Nouveau groupe')).toBeTruthy();
    expect(screen.queryByText('Ancien groupe')).toBeNull();
  });

  it('puts the bottom safe-area inset under the composer', async () => {
    mockBottomInset = 20;
    await open([]);
    expect(screen.getByTestId('composer').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ paddingBottom: 28 })]),
    );
  });

  it('takes the title and mute state from the page, with no separate call', async () => {
    mFetch.mockResolvedValue(page([], false, { muted: true }));
    await render(<Discussion />);
    await settle();
    expect(screen.getByText('Jeux de société')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réactiver les notifications' })).toBeTruthy();
  });
});

describe('discussion in the background', () => {
  it('does not mark read while the app is in the background, and does again when active', async () => {
    await open([msg(1, 'Salut')]);
    await setAppState('background');
    (markRead as jest.Mock).mockClear();
    mFetch.mockResolvedValue(page([msg(2, 'Nouveau'), msg(1, 'Salut')]));
    await setAppState('inactive');
    expect(markRead).not.toHaveBeenCalled();
    await setAppState('active');
    expect(markRead).toHaveBeenCalledWith('act1');
  });

  it('removes the channel in the background, then resubscribes and refreshes on active', async () => {
    await open([msg(1, 'Salut')]);
    expect(mockChannelFactory).toHaveBeenCalledTimes(1);
    mockRemoveChannel.mockClear();
    await setAppState('background');
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
    mFetch.mockClear();
    mFetch.mockResolvedValue(page([msg(2, 'Pendant'), msg(1, 'Salut')]));
    await setAppState('active');
    expect(mockChannelFactory).toHaveBeenCalledTimes(2);
    expect(mFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Pendant')).toBeTruthy();
  });

  it('marks read when leaving the screen, then signals the tab badge', async () => {
    await open([msg(1, 'Salut')]);
    const seen = jest.fn();
    const off = onUnreadChanged(seen);
    (markRead as jest.Mock).mockClear();
    await blurScreen();
    expect(markRead).toHaveBeenCalledWith('act1');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('marking read on blur', () => {
  it('does not mark read when leaving before the re-read after coming back has completed', async () => {
    await open([msg(1, 'Salut')]);
    await blurScreen();
    mFetch.mockImplementation(() => new Promise(() => {})); // the re-read never completes
    await focusScreen();
    (markRead as jest.Mock).mockClear();
    await blurScreen();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('marks read when the re-read after coming back has completed', async () => {
    await open([msg(1, 'Salut')]);
    await blurScreen();
    await focusScreen();
    (markRead as jest.Mock).mockClear();
    await blurScreen();
    expect(markRead).toHaveBeenCalledWith('act1');
  });
});

describe('blocking and the membership', () => {
  const pressBlock = async (name: string) => {
    await fireEvent(screen.getByText(name), 'longPress');
    await fireEvent.press(screen.getByRole('button', { name: 'Bloquer Camille' }));
  };

  it('warns that a member blocking the organiser also leaves the activity, then goes back', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open([msg(1, 'Salut', { sender: { id: 'org', firstName: 'Camille', photoUrl: null } })]);
    await pressBlock('Salut');
    expect(alert.mock.calls[0][1]).toBe('Vous ne verrez plus ses messages et vous quitterez cette activité.');
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    mFetch.mockClear();
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    await settle();
    expect(blockUser).toHaveBeenCalledWith('org');
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mFetch).not.toHaveBeenCalled();
    expect(screen.queryByText("Rejoignez l'activité pour participer à la discussion.")).toBeNull();
    alert.mockRestore();
  });

  it('warns that the organiser blocking a member removes them from the activity', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSession = { status: 'ready', userId: 'org' };
    await open([msg(1, 'Salut')]);
    await pressBlock('Salut');
    expect(alert.mock.calls[0][1]).toBe("Vous ne verrez plus ses messages et cette personne sera retirée de l'activité.");
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    mockRouter.back.mockClear();
    mFetch.mockResolvedValue(page([]));
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    await settle();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(screen.queryByText('Salut')).toBeNull();
    alert.mockRestore();
  });

  it('keeps the plain warning between two members', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await open([msg(1, 'Salut')]);
    await pressBlock('Salut');
    expect(alert.mock.calls[0][1]).toBe('Vous ne verrez plus ses messages.');
    alert.mockRestore();
  });
});

describe('signed-out account gate', () => {
  it('asks once per mount: a second signed_out shows the error screen', async () => {
    mFetch.mockResolvedValue({ ok: false, error: 'signed_out' });
    await render(<Discussion />);
    await settle();
    expect(mockGate).toHaveBeenCalledTimes(1);
    expect(mFetch).toHaveBeenCalledTimes(2); // the open, then the read after sign-in
    expect(screen.getByText('Impossible de charger la discussion. Réessayez.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Réessayer' }));
    await settle();
    expect(mockGate).toHaveBeenCalledTimes(1);
  });
});
