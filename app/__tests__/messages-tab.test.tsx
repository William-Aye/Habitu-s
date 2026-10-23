import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import Messages from '../src/app/(tabs)/messages';
import { myChats } from '../src/features/chat/api';
import { useUnreadCount } from '../src/features/chat/useUnreadCount';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});
jest.mock('../src/features/chat/api', () => ({ myChats: jest.fn() }));
const mockSession = { status: 'ready', userId: 'u1' };
jest.mock('../src/features/account/useSession', () => ({ useSession: () => mockSession }));

const mockChats = myChats as jest.Mock;
const chat = (over = {}) => ({
  activityId: 'a1',
  title: 'Marche douce',
  lastMessage: { body: 'On se retrouve a 10h', createdAt: new Date().toISOString(), senderFirstName: 'Lea' },
  unreadCount: 0,
  muted: false,
  ...over,
});

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
});

describe('Messages tab', () => {
  it('shows the empty state with an Explorer button', async () => {
    mockChats.mockResolvedValue({ ok: true, chats: [] });
    await render(<Messages />);
    expect(await screen.findByText("Aucune discussion pour l'instant")).toBeTruthy();
    expect(screen.getByText('Rejoignez une activité pour discuter avec le groupe.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Explorer' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('shows the empty state without any call when signed out', async () => {
    mockSession.status = 'signed_out';
    mockSession.userId = null as never;
    await render(<Messages />);
    expect(await screen.findByText("Aucune discussion pour l'instant")).toBeTruthy();
    expect(mockChats).not.toHaveBeenCalled();
  });

  it('lists rows in the returned order with last message and unread badges', async () => {
    mockChats.mockResolvedValue({
      ok: true,
      chats: [
        chat({ activityId: 'a1', title: 'Marche douce', unreadCount: 3 }),
        chat({ activityId: 'a2', title: 'Yoga', unreadCount: 120 }),
        chat({ activityId: 'a3', title: 'Lecture', lastMessage: null }),
      ],
    });
    await render(<Messages />);
    await screen.findByText('Marche douce');
    const titles = screen.getAllByTestId('chat-title').map((n) => n.props.children);
    expect(titles).toEqual(['Marche douce', 'Yoga', 'Lecture']);
    expect(screen.getAllByText('Lea : On se retrouve a 10h')).toHaveLength(2);
    expect(screen.getByText("Aucun message pour l'instant")).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('opens the discussion when a row is tapped', async () => {
    mockChats.mockResolvedValue({ ok: true, chats: [chat({ activityId: 'a9' })] });
    await render(<Messages />);
    await fireEvent.press(await screen.findByTestId('chat-row-a9'));
    expect(router.push).toHaveBeenCalledWith('/discussions/a9');
  });

  it('labels a muted discussion', async () => {
    mockChats.mockResolvedValue({ ok: true, chats: [chat({ muted: true })] });
    await render(<Messages />);
    expect(await screen.findByText('Notifications coupées')).toBeTruthy();
  });

  it('shows an error with retry when the list cannot load', async () => {
    mockChats.mockResolvedValueOnce({ ok: false, error: 'network' });
    mockChats.mockResolvedValueOnce({ ok: true, chats: [chat()] });
    await render(<Messages />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Marche douce')).toBeTruthy();
  });
});

describe('useUnreadCount (tab badge)', () => {
  it('sums the unread counts', async () => {
    mockChats.mockResolvedValue({
      ok: true,
      chats: [chat({ unreadCount: 2 }), chat({ activityId: 'a2', unreadCount: 5 })],
    });
    const { result } = await renderHook(() => useUnreadCount());
    await waitFor(() => expect(result.current.count).toBe(7));
  });

  it('makes no call when signed out and reports zero', async () => {
    mockSession.status = 'signed_out';
    mockSession.userId = null as never;
    const { result } = await renderHook(() => useUnreadCount());
    expect(result.current.count).toBe(0);
    expect(mockChats).not.toHaveBeenCalled();
  });

  it('refreshes when the app returns to the foreground', async () => {
    let handler: (s: string) => void = () => {};
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: any) => {
      handler = h;
      return { remove: jest.fn() };
    }) as never);
    mockChats.mockResolvedValueOnce({ ok: true, chats: [chat({ unreadCount: 1 })] });
    mockChats.mockResolvedValueOnce({ ok: true, chats: [chat({ unreadCount: 4 })] });
    const { result } = await renderHook(() => useUnreadCount());
    await waitFor(() => expect(result.current.count).toBe(1));
    await act(async () => handler('active'));
    await waitFor(() => expect(result.current.count).toBe(4));
    spy.mockRestore();
  });
});
