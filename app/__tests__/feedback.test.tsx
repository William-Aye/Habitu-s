import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FeedbackForm } from '../src/features/feedback/FeedbackForm';
import { sendFeedback } from '../src/features/feedback/api';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), canGoBack: jest.fn(() => true) } }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.4.2' } } }));
jest.mock('expo-device', () => ({ modelName: 'Pixel 9', isDevice: false }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file:///shot.png', width: 2000 }],
  })),
}));
const mockReencode = jest.fn(async (..._a: unknown[]) => ({
  size: 1000,
  arrayBuffer: async () => new ArrayBuffer(4),
}));
jest.mock('../src/features/account/avatar', () => ({ reencodeJpeg: (...a: unknown[]) => mockReencode(...a) }));

const mockGetSession = jest.fn();
const mockInvoke = jest.fn();
const mockUpload = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn();
const mockBucket = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    storage: {
      from: (b: string) => {
        mockBucket(b);
        return { upload: (...a: unknown[]) => mockUpload(...a) };
      },
    },
    from: (t: string) => {
      mockFrom(t);
      return { insert: (...a: unknown[]) => mockInsert(...a) };
    },
  },
}));

const mockSession = { userId: 'u1' as string | null };
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ status: 'ready', userId: mockSession.userId, profile: null, error: false, refresh: jest.fn() }),
}));
const mockTurnstile = jest.fn();
jest.mock('../src/features/account/Turnstile', () => ({
  Turnstile: (props: { onToken(t: string): void; action?: string }) => {
    const { useEffect } = require('react');
    mockTurnstile(props.action);
    useEffect(() => props.onToken('tok-1'), []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  },
}));

const UUID = /^u1\/[0-9a-f-]{36}\.jpg$/;
const THANKS = "Merci ! Votre message a bien été envoyé à l'équipe.";

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = 'u1';
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  mockInsert.mockResolvedValue({ error: null });
  mockUpload.mockResolvedValue({ error: null });
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('sendFeedback', () => {
  it('signed in: inserts with the app version, the device model and the app source', async () => {
    expect(await sendFeedback({ type: 'idea', body: '  Une idée  ' })).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('feedback');
    expect(mockInsert).toHaveBeenCalledWith({
      type: 'idea',
      body: 'Une idée',
      app_version: '1.4.2',
      device_model: 'Pixel 9',
      screenshot_path: null,
      source: 'app',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('signed in: re-encodes the screenshot and uploads it to <uid>/<uuid>.jpg before the insert', async () => {
    await sendFeedback({ type: 'problem', body: 'Bug', screenshotUri: 'file:///shot.png', screenshotWidth: 2000 });
    expect(mockReencode).toHaveBeenCalledWith('file:///shot.png', 2000, 1280);
    expect(mockBucket).toHaveBeenCalledWith('feedback-screenshots');
    const path = mockUpload.mock.calls[0][0] as string;
    expect(path).toMatch(UUID);
    expect(mockUpload.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg' });
    expect(mockInsert.mock.calls[0][0].screenshot_path).toBe(path);
  });

  it('signed in: a failed upload sends nothing', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'boom' } });
    expect(await sendFeedback({ type: 'other', body: 'x', screenshotUri: 'file:///s.png' })).toEqual({
      ok: false,
      error: 'network',
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('signed in: limit_reached is reported as such', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'limit_reached' } });
    expect(await sendFeedback({ type: 'idea', body: 'x' })).toEqual({ ok: false, error: 'limit_reached' });
  });

  it('signed out: calls submit-feedback with the token and never uploads a screenshot', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(
      await sendFeedback({ type: 'problem', body: 'Bug', turnstileToken: 'tok', screenshotUri: 'file:///s.png' }),
    ).toEqual({ ok: true });
    expect(mockInvoke).toHaveBeenCalledWith('submit-feedback', {
      body: { type: 'problem', body: 'Bug', app_version: '1.4.2', device_model: 'Pixel 9', turnstile_token: 'tok' },
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('signed out: maps 429 to the limit and 403 to a failed check', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockInvoke.mockResolvedValue({ data: null, error: { context: { status: 429 } } });
    expect(await sendFeedback({ type: 'idea', body: 'x', turnstileToken: 't' })).toEqual({
      ok: false,
      error: 'limit_reached',
    });
    mockInvoke.mockResolvedValue({ data: null, error: { context: { status: 403 } } });
    expect(await sendFeedback({ type: 'idea', body: 'x', turnstileToken: 't' })).toEqual({
      ok: false,
      error: 'captcha',
    });
  });
});

describe('sendFeedback limits', () => {
  it('refuses a screenshot above 5 MB once re-encoded, sending nothing', async () => {
    mockReencode.mockResolvedValueOnce({ size: 5 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer(4) });
    expect(await sendFeedback({ type: 'idea', body: 'x', screenshotUri: 'file:///s.png' })).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does not report a storage error that has a status as a network error', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'Forbidden', statusCode: '403' } });
    expect(await sendFeedback({ type: 'idea', body: 'x', screenshotUri: 'file:///s.png' })).toEqual({
      ok: false,
      error: 'unknown',
    });
    mockUpload.mockResolvedValue({ error: { message: 'too big', statusCode: '413' } });
    expect(await sendFeedback({ type: 'idea', body: 'x', screenshotUri: 'file:///s.png' })).toEqual({
      ok: false,
      error: 'too_large',
    });
  });
});

describe('FeedbackForm', () => {
  it('tells what is collected and for how long', async () => {
    await render(<FeedbackForm />);
    expect(
      screen.getByText(
        "Nous recevons votre message, la version de l'application et le modèle de l'appareil. Évitez d'y mettre des informations personnelles. Conservé 2 ans.",
      ),
    ).toBeTruthy();
  });

  it('shows the size message when the screenshot is too large', async () => {
    mockReencode.mockResolvedValueOnce({ size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(4) });
    await render(<FeedbackForm />);
    await fireEvent.press(screen.getByLabelText("Ajouter une capture d'écran"));
    await fireEvent.changeText(screen.getByLabelText('Votre message'), 'Bonjour');
    await fireEvent.press(screen.getByLabelText('Envoyer'));
    expect(await screen.findByText('Fichier trop volumineux (5 Mo maximum).')).toBeTruthy();
  });

  const send = () => screen.getByLabelText('Envoyer');
  const disabled = (el: { props: any }) => el.props.accessibilityState?.disabled === true;

  it('keeps Envoyer disabled while the message is empty', async () => {
    await render(<FeedbackForm />);
    expect(disabled(send())).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Votre message'), '   ');
    expect(disabled(send())).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Votre message'), 'Bonjour');
    expect(disabled(send())).toBe(false);
  });

  it('offers the three types, with Idée selected first', async () => {
    await render(<FeedbackForm />);
    expect(screen.getByLabelText('Idée').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByLabelText('Problème'));
    expect(screen.getByLabelText('Problème').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Autre')).toBeTruthy();
  });

  it('signed in: attaches a screenshot, sends once and thanks the sender', async () => {
    await render(<FeedbackForm />);
    await fireEvent.press(screen.getByLabelText("Ajouter une capture d'écran"));
    await fireEvent.changeText(screen.getByLabelText('Votre message'), 'Bonjour');
    const button = send();
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(await screen.findByText(THANKS)).toBeTruthy();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.calls[0][0].screenshot_path).toMatch(UUID);
  });

  it('signed out: no screenshot button, a feedback-action Turnstile token is sent', async () => {
    mockSession.userId = null;
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await render(<FeedbackForm />);
    expect(screen.queryByLabelText("Ajouter une capture d'écran")).toBeNull();
    expect(mockTurnstile).toHaveBeenCalledWith('feedback');
    await fireEvent.changeText(screen.getByLabelText('Votre message'), 'Bonjour');
    await waitFor(() => expect(disabled(send())).toBe(false));
    await fireEvent.press(send());
    await screen.findByText(THANKS);
    expect(mockInvoke.mock.calls[0][1].body.turnstile_token).toBe('tok-1');
  });

  it('shows the limit text on limit_reached', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'limit_reached' } });
    await render(<FeedbackForm />);
    await fireEvent.changeText(screen.getByLabelText('Votre message'), 'Bonjour');
    await fireEvent.press(send());
    expect(await screen.findByText("Vous avez atteint la limite d'envois. Réessayez plus tard.")).toBeTruthy();
    expect(disabled(send())).toBe(false);
  });
});
