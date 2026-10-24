import AsyncStorage from '@react-native-async-storage/async-storage';
import { Share } from 'react-native';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '../src/i18n';
import fr from '../src/i18n/locales/fr.json';
import ActivityScreen from '../src/app/activites/[id]';
import SafetyTipsScreen from '../src/app/safety-tips';
import { getActivity, setAttendance } from '../src/features/activities/api';
import { SessionRow } from '../src/features/activities/SessionRow';
import { TIPS, resetTipsCache, useTipSeen } from '../src/features/safety/tips';
import { shareMyPlans } from '../src/features/safety/shareMyPlans';
import { listSeenTips, markTipsSeen } from '../src/features/safety/tipsApi';
import type { ActivityPage, SessionInfo } from '../src/features/activities/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({ id: 'act1' }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../src/features/explore/components/TownMap', () => ({ TownMap: () => null }));
jest.mock('../src/features/notifications/registerPush', () => ({ askForPush: jest.fn(async () => {}) }));
jest.mock('../src/features/activities/api', () => ({
  getActivity: jest.fn(),
  joinActivity: jest.fn(),
  leaveActivity: jest.fn(),
  setAttendance: jest.fn(),
  updateSession: jest.fn(),
  decideJoinRequest: jest.fn(),
  setWelcomeMember: jest.fn(),
  archiveActivity: jest.fn(),
  getChatHistory: jest.fn(),
  setChatHistory: jest.fn(),
  activityRoster: jest.fn(),
}));
jest.mock('../src/features/safety/reports', () => ({ reportTarget: jest.fn() }));
jest.mock('../src/features/safety/tipsApi', () => ({ listSeenTips: jest.fn(), markTipsSeen: jest.fn() }));
const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));
let mockSession: { status: string; userId: string | null } = { status: 'ready', userId: 'me' };
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ ...mockSession, profile: { firstName: 'Moi' } }),
}));

const mList = listSeenTips as jest.Mock;
const mMark = markTipsSeen as jest.Mock;
const mGet = getActivity as jest.Mock;

const TIP_A = 'Pour une première rencontre, restez dans le lieu public et organisez votre propre trajet.';
const TIP_B = "Prévenez un proche de l'endroit où vous allez.";
const TIP_MOVED =
  'Les activités doivent se dérouler dans un lieu public. Si ce nouveau lieu vous semble inadapté, signalez-le.';

const IN_3_DAYS = new Date(Date.now() + 3 * 86_400_000).toISOString();
const CONFIRMED = { status: 'confirmed' as const, guestCount: 0 };
function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1', startsAt: IN_3_DAYS, placeLabel: 'Café des Arts', isDiscovery: false, status: 'scheduled',
    confirmedCount: 4, isFull: false, myAttendance: null, ...over,
  };
}
function activity(over: Partial<ActivityPage> = {}): ActivityPage {
  return {
    id: 'act1', title: 'Jeux de société', description: null, category: null, tags: [],
    organiser: { id: 'org1', firstName: 'Olivier', photoUrl: null }, organisedBy: null, placeLabel: 'Café des Arts',
    lon: 4.85, lat: 45.77, recurrence: { kind: 'weekly' }, startDate: '2026-10-20', startTime: '19:00:00',
    durationMinutes: 120, timezone: 'Europe/Paris', maxSize: null, newcomerFriendly: true,
    approvalMode: 'open', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null, isOrganiser: false,
    myStatus: 'member', myPastAttendanceCount: 0, nextSessions: [session()], ...over,
  } as ActivityPage;
}
async function openActivity(a: ActivityPage) {
  mGet.mockResolvedValue({ ok: true, activity: a });
  await render(<ActivityScreen />);
  await screen.findByText(a.title);
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetTipsCache();
  mockSession = { status: 'ready', userId: 'me' };
  mockGate.mockResolvedValue(true);
  mList.mockResolvedValue({ ok: true, tips: [] });
  mMark.mockResolvedValue({ ok: true });
});

describe('tips list', () => {
  it('has the three contextual tips as i18n keys that exist in French', () => {
    expect(Object.keys(TIPS).sort()).toEqual(['first_session', 'moved_place', 'where']);
    expect(TIPS.where).toEqual(['create.where.homeTip']);
    const lookup = (key: string) => key.split('.').reduce<any>((o, k) => o?.[k], fr);
    for (const keys of Object.values(TIPS)) for (const k of keys) expect(typeof lookup(k)).toBe('string');
  });
});

describe('shareMyPlans', () => {
  const share = () => jest.spyOn(Share, 'share');
  it('sends the exact French message with the Paris time in summer (UTC+2)', async () => {
    const spy = share().mockResolvedValue({ action: 'sharedAction' } as never);
    const r = await shareMyPlans(session({ startsAt: '2026-07-15T17:00:00Z' }), activity());
    expect(r).toBe('shared');
    expect(spy).toHaveBeenCalledWith({
      message: 'Jeux de société — mercredi 15 juillet à 19:00, Café des Arts. Je vous préviens au cas où. (Habitués)',
    });
  });
  it('uses UTC+1 in winter', async () => {
    const spy = share().mockResolvedValue({ action: 'sharedAction' } as never);
    await shareMyPlans(session({ startsAt: '2026-01-14T18:00:00Z' }), activity());
    expect(spy.mock.calls[0][0]).toEqual({
      message: 'Jeux de société — mercredi 14 janvier à 19:00, Café des Arts. Je vous préviens au cas où. (Habitués)',
    });
  });
  it('is right on the day the clocks change (2026-03-29, 02:00 becomes 03:00)', async () => {
    const spy = share().mockResolvedValue({ action: 'sharedAction' } as never);
    await shareMyPlans(session({ startsAt: '2026-03-29T08:30:00Z' }), activity());
    expect(spy.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('dimanche 29 mars à 10:30') });
  });
  it("falls back to the activity's place and reports a dismissed sheet", async () => {
    const spy = share().mockResolvedValue({ action: 'dismissedAction' } as never);
    const r = await shareMyPlans(session({ placeLabel: '' }), activity({ placeLabel: 'Salle Rivoli' }));
    expect(r).toBe('dismissed');
    expect(spy.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('Salle Rivoli.') });
  });
});

describe('first_session tip on the activity page', () => {
  it('shows after the first confirmation and "Compris" hides it for good', async () => {
    mGet.mockResolvedValueOnce({ ok: true, activity: activity({ nextSessions: [session()] }) });
    (setAttendance as jest.Mock).mockResolvedValue({ ok: true });
    await render(<ActivityScreen />);
    await screen.findByText('Jeux de société');
    expect(screen.queryByText(TIP_A)).toBeNull();

    mGet.mockResolvedValue({ ok: true, activity: activity({ nextSessions: [session({ myAttendance: CONFIRMED })] }) });
    await fireEvent.press(screen.getByRole('button', { name: /Je serai là/ }));
    expect(await screen.findByText(TIP_A)).toBeTruthy();
    expect(screen.getByText(TIP_B)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Compris' }));
    await waitFor(() => expect(screen.queryByText(TIP_A)).toBeNull());
    expect(mMark).toHaveBeenCalledWith(['first_session']);
  });

  it('is not shown again once seen (second confirmation, later visit)', async () => {
    mList.mockResolvedValue({ ok: true, tips: ['first_session'] });
    await openActivity(activity({ nextSessions: [session({ myAttendance: CONFIRMED })] }));
    await waitFor(() => expect(mList).toHaveBeenCalled());
    expect(screen.queryByText(TIP_A)).toBeNull();
  });

  it('is not shown to someone who already attended before', async () => {
    await openActivity(activity({ myPastAttendanceCount: 2, nextSessions: [session({ myAttendance: CONFIRMED })] }));
    expect(screen.getByText('Confirmé')).toBeTruthy();
    expect(screen.queryByText(TIP_A)).toBeNull();
  });

  it('stays hidden while the seen list cannot be read', async () => {
    mList.mockResolvedValue({ ok: false, error: 'network' });
    await openActivity(activity({ nextSessions: [session({ myAttendance: CONFIRMED })] }));
    await waitFor(() => expect(mList).toHaveBeenCalled());
    expect(screen.queryByText(TIP_A)).toBeNull();
  });

  it('offers Partager mon programme on the tip and permanently on the confirmed row', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await openActivity(activity({ nextSessions: [session({ myAttendance: CONFIRMED })] }));
    await screen.findByText(TIP_A);
    expect(screen.getAllByRole('button', { name: /Partager mon programme/ })).toHaveLength(2);
    await fireEvent.press(screen.getAllByRole('button', { name: /Partager mon programme/ })[1]);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0][0]).toMatchObject({ message: expect.stringContaining('Jeux de société — ') });
  });

  it('keeps the row share button after the tip is seen, and none on unconfirmed rows', async () => {
    mList.mockResolvedValue({ ok: true, tips: ['first_session'] });
    await openActivity(activity({ nextSessions: [session({ myAttendance: CONFIRMED }), session({ id: 's2' })] }));
    await waitFor(() => expect(mList).toHaveBeenCalled());
    expect(screen.getAllByRole('button', { name: /Partager mon programme/ })).toHaveLength(1);
  });
});

describe('moved_place tip', () => {
  it('shows on a session held somewhere else, with a link to report the session', async () => {
    await openActivity(activity({ nextSessions: [session({ placeLabel: 'Appartement rue X' })] }));
    expect(await screen.findByText(TIP_MOVED)).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Signaler cette séance' });
    expect(links.length).toBeGreaterThanOrEqual(2);
    await fireEvent.press(links[0]);
    expect(await screen.findByRole('radio', { name: 'Lieu dangereux ou inadapté' })).toBeTruthy();
  });

  it('does not show when the place is the activity place', async () => {
    await openActivity(activity());
    expect(screen.queryByText(TIP_MOVED)).toBeNull();
  });

  it('is hidden by Compris', async () => {
    await openActivity(activity({ nextSessions: [session({ placeLabel: 'Ailleurs' })] }));
    await screen.findByText(TIP_MOVED);
    await fireEvent.press(screen.getByRole('button', { name: 'Compris' }));
    await waitFor(() => expect(screen.queryByText(TIP_MOVED)).toBeNull());
    expect(mMark).toHaveBeenCalledWith(['moved_place']);
  });
});

describe('Conseils de sécurité page', () => {
  it('lists every tip, including the home tip, with no dismiss', async () => {
    mList.mockResolvedValue({ ok: true, tips: ['first_session', 'moved_place'] });
    await render(<SafetyTipsScreen />);
    expect(screen.getByRole('header', { name: 'Conseils de sécurité' })).toBeTruthy();
    expect(screen.getByText(fr.create.where.homeTip)).toBeTruthy();
    expect(screen.getByText(TIP_A)).toBeTruthy();
    expect(screen.getByText(TIP_B)).toBeTruthy();
    expect(screen.getByText(TIP_MOVED)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compris' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Partager mon programme/ })).toBeNull();
  });
});

describe('useTipSeen', () => {
  it('signed in: reads once and writes the server', async () => {
    mList.mockResolvedValue({ ok: true, tips: ['where'] });
    const where = await renderHook(() => useTipSeen('where'));
    await waitFor(() => expect(where.result.current.seen).toBe(true));
    const first = await renderHook(() => useTipSeen('first_session'));
    await waitFor(() => expect(mList).toHaveBeenCalled());
    expect(first.result.current.seen).toBe(false);
    await act(async () => {
      await first.result.current.dismiss();
    });
    await waitFor(() => expect(first.result.current.seen).toBe(true));
    expect(first.result.current.seen).toBe(true);
    expect(mMark).toHaveBeenCalledWith(['first_session']);
    expect(mList).toHaveBeenCalledTimes(1);
  });

  it('signed out: dismissal persists on the device and is copied to the server after sign-in', async () => {
    mockSession = { status: 'signed_out', userId: null };
    const out = await renderHook(() => useTipSeen('first_session'));
    await waitFor(() => expect(out.result.current.seen).toBe(false));
    await act(async () => {
      await out.result.current.dismiss();
    });
    await waitFor(() => expect(out.result.current.seen).toBe(true));
    expect(out.result.current.seen).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem('tips.seen.v1')) as string)).toEqual(['first_session']);
    expect(mMark).not.toHaveBeenCalled();
    await out.unmount();

    // A fresh start of the app still remembers.
    resetTipsCache();
    const again = await renderHook(() => useTipSeen('first_session'));
    await waitFor(() => expect(again.result.current.seen).toBe(true));
    await again.unmount();

    // Signing in copies the local values to the server and empties the local copy.
    resetTipsCache();
    mockSession = { status: 'ready', userId: 'me' };
    mList.mockResolvedValue({ ok: true, tips: [] });
    const signedIn = await renderHook(() => useTipSeen('first_session'));
    await waitFor(() => expect(mMark).toHaveBeenCalledWith(['first_session']));
    await waitFor(() => expect(signedIn.result.current.seen).toBe(true));
    await waitFor(() => expect(AsyncStorage.removeItem).toHaveBeenCalledWith('tips.seen.v1'));
    expect(await AsyncStorage.getItem('tips.seen.v1')).toBeNull();
  });

  it('keeps the local values when the copy to the server fails', async () => {
    await AsyncStorage.setItem('tips.seen.v1', JSON.stringify(['moved_place']));
    mMark.mockResolvedValue({ ok: false, error: 'network' });
    await renderHook(() => useTipSeen('moved_place'));
    await waitFor(() => expect(mMark).toHaveBeenCalled());
    expect(await AsyncStorage.getItem('tips.seen.v1')).not.toBeNull();
  });
});

describe('SessionRow alone', () => {
  it('has no share button for someone who has not confirmed', async () => {
    await render(
      <SessionRow session={session()} activity={activity()} showWelcome={false} showFirstTip={false} onChanged={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: /Partager mon programme/ })).toBeNull();
  });
});
