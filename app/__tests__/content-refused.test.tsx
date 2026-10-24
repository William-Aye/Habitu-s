import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initI18n } from '../src/i18n';
import { mapError } from '../src/features/activities/errors';
import { sendMessage } from '../src/features/chat/api';
import { MessageBubble } from '../src/features/chat/MessageBubble';
import { Composer } from '../src/features/chat/Composer';
import type { DisplayMessage } from '../src/features/chat/useChat';
import type { PendingMessage } from '../src/features/chat/types';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
const mockInsert = jest.fn();
const mockGetSession = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    from: () => ({ insert: (...a: unknown[]) => mockInsert(...a) }),
    auth: { getSession: (...a: unknown[]) => mockGetSession(...a) },
  },
}));

const REFUSED = { code: '23514', message: 'content_refused' };
const FR = 'Ce texte contient un mot interdit.';

beforeAll(async () => {
  await initI18n();
});
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

describe('error mapping', () => {
  it('maps the word filter to content_refused', () => {
    expect(mapError(REFUSED)).toBe('content_refused');
    expect(mapError({ code: '23514', message: 'some other check' })).toBe('unknown');
  });

  it('has a French and an English text where text is sent: activities, collectifs, chat', () => {
    for (const key of ['create.errors.content_refused', 'collectif.errors.content_refused', 'chat.errors.content_refused']) {
      expect(i18next.t(key)).toBe(FR);
      expect(i18next.t(key, { lng: 'en' })).toBe('This text contains a forbidden word.');
    }
  });

  it('publishing an activity reads create.errors.<code>, so the mapped code shows the message', () => {
    expect(i18next.t(`create.errors.${mapError(REFUSED)}`)).toBe(FR);
  });
});

describe('chat send', () => {
  it('returns content_refused from the API', async () => {
    mockInsert.mockResolvedValue({ error: REFUSED });
    expect(await sendMessage('u1', 'a1', 'id1', 'texte')).toEqual({ ok: false, error: 'content_refused' });
  });

  it('is a permanent failure in the outbox: kept as failed with its text, never sent again', async () => {
    mockInsert.mockResolvedValue({ error: REFUSED });
    jest.useFakeTimers();
    const ob = require('../src/features/chat/outbox') as typeof import('../src/features/chat/outbox');
    await ob.ready();
    const m = ob.enqueue('u1', 'a1', 'texte refusé')!;
    await jest.advanceTimersByTimeAsync(0);
    await ob.flush();
    expect(ob.pending('a1', 'u1')[0]).toMatchObject({
      id: m.id,
      state: 'failed',
      error: 'content_refused',
      body: 'texte refusé',
    });
    await jest.advanceTimersByTimeAsync(120_000);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
    ob.discard(m.id);
  });
});

describe('refused message bubble', () => {
  const refused = (): DisplayMessage => {
    const pending: PendingMessage = {
      id: 'p1',
      userId: 'u1',
      activityId: 'a1',
      body: 'texte refusé',
      createdAt: '2026-10-24T10:00:00Z',
      state: 'failed',
      error: 'content_refused',
      attempts: 0,
      stalled: false,
    };
    return {
      id: 'p1',
      body: 'texte refusé',
      createdAt: pending.createdAt,
      sender: { id: 'u1', firstName: 'Moi', photoUrl: null },
      isMine: true,
      pending,
    };
  };

  it('shows the message and hands the text back for editing, never retrying', async () => {
    const onEdit = jest.fn();
    const onRetry = jest.fn();
    await render(<MessageBubble message={refused()} onLongPress={jest.fn()} onRetry={onRetry} onEdit={onEdit} />);
    expect(screen.getByText(FR)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('texte refusé'));
    expect(onEdit).toHaveBeenCalledWith('p1');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('puts the refused text back in the composer', async () => {
    const onSend = jest.fn(() => true);
    const view = await render(<Composer onSend={onSend} draft={null} />);
    await view.rerender(<Composer onSend={onSend} draft={{ text: 'texte refusé', key: 1 }} />);
    expect(screen.getByDisplayValue('texte refusé')).toBeTruthy();
  });
});
