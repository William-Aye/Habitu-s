import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { initI18n } from '../src/i18n';
import ModerationScreen from '../src/app/moderation';
import { handleNotificationResponse, openActivityFor } from '../src/features/notifications/responses';
import { fetchModerationNotices, unreadCount } from '../src/features/safety/notices';
import { mapAuthError } from '../src/features/account/auth';
import { isBannedError } from '../src/features/account/banned';
import { SuspendedNotice } from '../src/features/account/SuspendedNotice';
import { SessionProvider, useSession } from '../src/features/account/useSession';
import { PRIVACY_CONTACT } from '../src/content/contact';
import { privacyFr } from '../src/content/privacy.fr';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));
jest.mock('../src/features/activities/api', () => ({ setAttendanceStatus: jest.fn() }));
jest.mock('../src/features/chat/outbox', () => ({ clearOutbox: jest.fn(), flush: jest.fn() }));
jest.mock('../src/features/notifications/registerPush', () => ({ unregisterThisDevice: jest.fn(async () => {}) }));
const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));
const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
const mockGetSession = jest.fn();
const mockOnAuth = jest.fn();
const mockSignOut = jest.fn();
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }) }) }),
    auth: {
      getSession: (...a: unknown[]) => mockGetSession(...a),
      onAuthStateChange: (...a: unknown[]) => mockOnAuth(...a),
      signOut: (...a: unknown[]) => mockSignOut(...a),
    },
  },
}));

// The screens read a fake session; the "real" mode runs the actual provider.
let mockSession: { status: string; userId: string | null; banned?: boolean } = { status: 'ready', userId: 'me' };
jest.mock('../src/features/account/useSession', () => {
  const actual = jest.requireActual('../src/features/account/useSession');
  return {
    ...actual,
    useSession: (...a: unknown[]) => (mockSession.status === 'real' ? actual.useSession(...a) : mockSession),
  };
});

const NOTICES = {
  decisions: [
    {
      report_id: 'r1',
      decision: 'remove',
      statement_of_reasons: 'Ce message contenait des propos injurieux envers un membre.',
      decided_at: '2026-10-20T10:00:00Z',
      target_type: 'message',
      target_id: 'm1',
    },
  ],
  handled_reports: [{ report_id: 'r2', status: 'actioned', decided_at: '2026-10-21T10:00:00Z' }],
};

beforeAll(async () => {
  await initI18n();
});
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSession = { status: 'ready', userId: 'me' };
  mockGate.mockResolvedValue(true);
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'me' } } }, error: null });
  mockRpc.mockResolvedValue({ data: NOTICES, error: null });
});

describe('moderation notices', () => {
  it('reads the notices through my_moderation_notices', async () => {
    const r = await fetchModerationNotices();
    expect(mockRpc).toHaveBeenCalledWith('my_moderation_notices');
    expect(r).toMatchObject({
      ok: true,
      notices: {
        decisions: [{ reportId: 'r1', decision: 'remove', targetType: 'message' }],
        handledReports: [{ reportId: 'r2', status: 'actioned' }],
      },
    });
  });

  it('shows the decision, its statement of reasons and the handled report', async () => {
    await render(<ModerationScreen />);
    expect(await screen.findByText('Ce message contenait des propos injurieux envers un membre.')).toBeTruthy();
    expect(screen.getByText('Contenu retiré')).toBeTruthy();
    expect(screen.getByText('Votre signalement a été traité')).toBeTruthy();
    expect(screen.getByText('Informations de modération')).toBeTruthy();
  });

  it('counts unseen items until the screen has been opened', async () => {
    expect(await unreadCount('me')).toBe(2);
    await render(<ModerationScreen />);
    await screen.findByText('Contenu retiré');
    expect(screen.getAllByText('Nouveau')).toHaveLength(2);
    await waitFor(async () => expect(await unreadCount('me')).toBe(0));
  });

  it('says so when there is nothing, and can retry after a failure', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await render(<ModerationScreen />);
    expect(await screen.findByText(/Impossible de charger/)).toBeTruthy();
    mockRpc.mockResolvedValue({ data: { decisions: [], handled_reports: [] }, error: null });
    await fireEvent.press(screen.getByLabelText('Réessayer'));
    expect(await screen.findByText('Aucune information de modération.')).toBeTruthy();
  });

  it('leaves the screen when the sign-in prompt is declined', async () => {
    mockSession = { status: 'signed_out', userId: null };
    mockGate.mockResolvedValue(false);
    await render(<ModerationScreen />);
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('notification taps', () => {
  const response = (data: Record<string, unknown>, id = Math.random().toString()) =>
    ({
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: { request: { identifier: id, content: { data } } },
    }) as never;

  it.each([
    ['report_handled', { report_id: 'r1' }],
    ['moderation_notice', { report_id: 'r1' }],
  ])('%s opens the moderation screen', async (kind, extra) => {
    await handleNotificationResponse(response({ kind, ...extra }));
    expect(router.push).toHaveBeenCalledWith('/moderation');
  });

  it('opens the moderation screen from the signed-out path, and not twice', async () => {
    openActivityFor(response({ kind: 'moderation_notice' }));
    expect(router.push).toHaveBeenCalledWith('/moderation');
    (router.push as jest.Mock).mockClear();
    await handleNotificationResponse(response({ kind: 'moderation_notice' }), { alreadyOpened: true });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('claim_decided opens the association the claim was about', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { association_id: 'as1' }, error: null });
    await handleNotificationResponse(response({ kind: 'claim_decided', claim_id: 'c1' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/associations/[id]', params: { id: 'as1' } });
  });

  it('claim_decided falls back to Profil when the claim cannot be read', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'x' } });
    await handleNotificationResponse(response({ kind: 'claim_decided', claim_id: 'c1' }));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/profile');
  });

  it('category_decided opens the interests screen', async () => {
    await handleNotificationResponse(response({ kind: 'category_decided', request_id: 'q1' }));
    expect(router.push).toHaveBeenCalledWith('/interests');
  });

  it('inactivity_notice opens Profil', async () => {
    await handleNotificationResponse(response({ kind: 'inactivity_notice' }));
    expect(router.push).toHaveBeenCalledWith('/(tabs)/profile');
  });

  it('handles each response once', async () => {
    const r = response({ kind: 'category_decided' }, 'same');
    await handleNotificationResponse(r);
    await handleNotificationResponse(r);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('still opens an activity for a reminder that carries a kind', async () => {
    await handleNotificationResponse(response({ kind: 'session_reminder', activity_id: 'a1' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'a1' } });
  });
});

describe('suspended account', () => {
  const MESSAGE =
    "Votre compte a été suspendu pour non-respect des règles d'utilisation. Pour connaître le motif de la décision ou la contester, écrivez à " +
    PRIVACY_CONTACT +
    '.';

  it('recognises the Supabase Auth ban error', () => {
    expect(isBannedError({ code: 'user_banned', status: 403, message: 'User is banned' })).toBe(true);
    expect(isBannedError({ message: 'User is banned' })).toBe(true);
    expect(isBannedError({ message: 'Invalid token' })).toBe(false);
    expect(isBannedError(null)).toBe(false);
    expect(mapAuthError({ code: 'user_banned', status: 403, message: 'User is banned' })).toBe('banned');
  });

  it('uses the privacy contact address of the privacy text', () => {
    expect(privacyFr).toContain(PRIVACY_CONTACT);
  });

  it('the session reports a ban from a refused refresh and shows the notice', async () => {
    mockSession = { status: 'real', userId: null };
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'user_banned', message: 'User is banned' },
    });
    mockOnAuth.mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } });
    const wrapper = ({ children }: { children: ReactNode }) => <SessionProvider>{children}</SessionProvider>;
    const hook = await renderHook(() => useSession(), { wrapper });
    await waitFor(() => expect(hook.result.current.banned).toBe(true));
    expect(hook.result.current.status).toBe('signed_out');
    expect(hook.result.current.error).toBe(false);

    await render(<SuspendedNotice />, { wrapper });
    expect(await screen.findByText(MESSAGE)).toBeTruthy();
    mockSignOut.mockResolvedValue({ error: null });
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Compris'));
    });
    await waitFor(() => expect(screen.queryByTestId('suspended-notice')).toBeNull());
  });

  it('shows nothing for an account in good standing', async () => {
    mockSession = { status: 'ready', userId: 'me', banned: false };
    await render(<SuspendedNotice />);
    expect(screen.queryByTestId('suspended-notice')).toBeNull();
  });
});
