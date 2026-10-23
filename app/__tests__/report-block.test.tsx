import { Alert } from 'react-native';
import { router } from 'expo-router';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { initI18n } from '../src/i18n';
import ActivityScreen from '../src/app/activites/[id]';
import Association from '../src/app/associations/[id]';
import CollectifScreen from '../src/app/collectifs/[id]';
import { ReportSheet } from '../src/features/safety/ReportSheet';
import { BlockedList } from '../src/features/safety/BlockedList';
import BlockedScreen from '../src/app/blocked';
import { block, listBlocked, unblock } from '../src/features/safety/blocks';
import { reportTarget } from '../src/features/safety/reports';
import { activityRoster, getActivity, getChatHistory } from '../src/features/activities/api';
import { getAssociation } from '../src/features/explore/api';
import { getCollectif, myInvitation } from '../src/features/collectifs/api';
import type { ActivityPage, CollectifPage, SessionInfo } from '../src/features/activities/types';
import type { ReportTargetType } from '../src/features/safety/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
let mockParams: Record<string, string> = { id: 'act1' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
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
jest.mock('../src/features/explore/api', () => ({
  getAssociation: jest.fn(),
  addWaiter: jest.fn(),
  removeWaiter: jest.fn(),
}));
jest.mock('../src/features/collectifs/api', () => ({
  getCollectif: jest.fn(),
  myInvitation: jest.fn(),
  answerInvitation: jest.fn(),
  inviteOrganiser: jest.fn(),
  listCandidates: jest.fn(),
  updateCollectif: jest.fn(),
  leaveCollectif: jest.fn(),
  deleteCollectif: jest.fn(),
}));
jest.mock('../src/features/safety/reports', () => ({ reportTarget: jest.fn() }));
jest.mock('../src/features/safety/blocks', () => ({ block: jest.fn(), unblock: jest.fn(), listBlocked: jest.fn() }));
const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));
let mockSession: { status: string; userId: string | null } = { status: 'ready', userId: 'me' };
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ ...mockSession, profile: { firstName: 'Moi' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mReport = reportTarget as jest.Mock;
const mBlock = block as jest.Mock;
const mUnblock = unblock as jest.Mock;
const mList = listBlocked as jest.Mock;

const IN_3_DAYS = new Date(Date.now() + 3 * 86_400_000).toISOString();
function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1', startsAt: IN_3_DAYS, placeLabel: 'Café des Arts', isDiscovery: false, status: 'scheduled',
    confirmedCount: 4, isFull: false, myAttendance: null, ...over,
  };
}
function activity(over: Partial<ActivityPage> = {}): ActivityPage {
  return {
    id: 'act1', title: 'Jeux de société', description: null,
    category: null, tags: [],
    organiser: { id: 'org1', firstName: 'Olivier', photoUrl: null }, organisedBy: null, placeLabel: 'Café des Arts',
    lon: 4.85, lat: 45.77, recurrence: { kind: 'weekly' }, startDate: '2026-10-20', startTime: '19:00:00',
    durationMinutes: 120, timezone: 'Europe/Paris', maxSize: null, newcomerFriendly: true,
    approvalMode: 'open', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null, isOrganiser: false,
    myStatus: 'none', nextSessions: [session()], ...over,
  } as ActivityPage;
}
async function openActivity(a: ActivityPage) {
  (getActivity as jest.Mock).mockResolvedValue({ ok: true, activity: a });
  await render(<ActivityScreen />);
  await screen.findByText(a.title);
}
const REASON_CHOICES = {
  unsafe_place: 'Lieu dangereux ou inadapté',
  inappropriate_behaviour: 'Comportement inapproprié',
  harassment: 'Harcèlement',
  fake_or_spam: 'Faux ou spam',
  did_not_happen: "N'a pas eu lieu",
  other: 'Autre',
};
const SEND = 'Envoyer le signalement';
async function sendReport(reason: string, details?: string) {
  await fireEvent.press(await screen.findByRole('radio', { name: reason }));
  if (details !== undefined) await fireEvent.changeText(screen.getByLabelText('Précisez (facultatif)'), details);
  await fireEvent.press(screen.getByRole('button', { name: SEND }));
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'act1' };
  mockSession = { status: 'ready', userId: 'me' };
  (router.canGoBack as jest.Mock).mockReturnValue(true);
  mockGate.mockResolvedValue(true);
  mReport.mockResolvedValue({ ok: true });
  mBlock.mockResolvedValue({ ok: true });
  mUnblock.mockResolvedValue({ ok: true });
  mList.mockResolvedValue({ ok: true, blocked: [] });
  (getChatHistory as jest.Mock).mockResolvedValue({ ok: true, chatHistory: 'all' });
  (activityRoster as jest.Mock).mockResolvedValue({ ok: true, people: [] });
});

describe('ReportSheet', () => {
  it.each<[ReportTargetType, string[]]>([
    ['user', ['inappropriate_behaviour', 'harassment', 'fake_or_spam', 'other']],
    ['message', ['inappropriate_behaviour', 'harassment', 'fake_or_spam', 'other']],
    ['collectif', ['inappropriate_behaviour', 'harassment', 'fake_or_spam', 'other']],
    ['association', ['unsafe_place', 'inappropriate_behaviour', 'harassment', 'fake_or_spam', 'other']],
    ['activity', ['unsafe_place', 'inappropriate_behaviour', 'harassment', 'fake_or_spam', 'did_not_happen', 'other']],
    ['session', ['unsafe_place', 'inappropriate_behaviour', 'harassment', 'fake_or_spam', 'did_not_happen', 'other']],
  ])('offers the reasons that fit a %s', async (type, reasons) => {
    await render(<ReportSheet target={{ type, id: 'x' }} visible onClose={() => {}} />);
    const shown = screen.getAllByRole('radio').map((r) => r.props.accessibilityLabel);
    expect(shown).toEqual(reasons.map((r) => REASON_CHOICES[r as keyof typeof REASON_CHOICES]));
  });

  it('sends the reason and trimmed details, then thanks', async () => {
    await render(<ReportSheet target={{ type: 'activity', id: 'a9' }} visible onClose={() => {}} />);
    await sendReport('Harcèlement', '  il insiste  ');
    expect(mReport).toHaveBeenCalledWith('activity', 'a9', 'harassment', 'il insiste');
    expect(await screen.findByText('Merci, votre signalement a été envoyé.')).toBeTruthy();
  });

  it('sends no details when the field is empty or blank', async () => {
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={() => {}} />);
    await sendReport('Autre', '   ');
    expect(mReport).toHaveBeenCalledWith('user', 'u1', 'other', undefined);
  });

  it('keeps send disabled until a reason is chosen, and limits the details to 500 characters', async () => {
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={() => {}} />);
    const send = screen.getByRole('button', { name: SEND });
    expect(send.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(send);
    expect(mReport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Précisez (facultatif)').props.maxLength).toBe(500);
  });

  it('is busy while sending: one call only', async () => {
    let resolve!: (v: unknown) => void;
    mReport.mockReturnValue(new Promise((r) => (resolve = r)));
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={() => {}} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Autre' }));
    // Not awaited: the press only settles once the report has been answered.
    const pressed = fireEvent.press(screen.getByRole('button', { name: SEND }));
    await waitFor(() => expect(screen.getByRole('button', { name: SEND }).props.accessibilityState.disabled).toBe(true));
    await fireEvent.press(screen.getByRole('button', { name: SEND }));
    expect(mReport).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    await pressed;
  });

  it('shows the limit text on limit_reached', async () => {
    mReport.mockResolvedValue({ ok: false, error: 'limit_reached' });
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={() => {}} />);
    await sendReport('Autre');
    expect(
      await screen.findByText('Vous avez atteint la limite de signalements. Réessayez plus tard.'),
    ).toBeTruthy();
  });

  it('shows a generic error otherwise and lets the person retry', async () => {
    mReport.mockResolvedValue({ ok: false, error: 'network' });
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={() => {}} />);
    await sendReport('Autre');
    expect(await screen.findByText('Action impossible. Réessayez.')).toBeTruthy();
    expect(screen.getByRole('button', { name: SEND }).props.accessibilityState.disabled).toBe(false);
  });
});

describe('ReportSheet edge cases', () => {
  it('locks against a double submit made in the same tick', async () => {
    let resolve!: (v: unknown) => void;
    mReport.mockReturnValue(new Promise((r) => (resolve = r)));
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={() => {}} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Autre' }));
    const send = screen.getByRole('button', { name: SEND });
    await act(async () => {
      void fireEvent.press(send);
      void fireEvent.press(send);
    });
    expect(mReport).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
  });

  it('says the content is gone on not_allowed and closes the sheet', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onClose = jest.fn();
    mReport.mockResolvedValue({ ok: false, error: 'not_allowed' });
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={onClose} />);
    await sendReport('Autre');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toBe("Ce contenu n'est plus disponible.");
    alert.mockRestore();
  });

  it('asks for an account on signed_out', async () => {
    const onClose = jest.fn();
    mReport.mockResolvedValue({ ok: false, error: 'signed_out' });
    await render(<ReportSheet target={{ type: 'user', id: 'u1' }} visible onClose={onClose} />);
    await sendReport('Autre');
    await waitFor(() => expect(mockGate).toHaveBeenCalledWith('join'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('entry points', () => {
  it('activity page: reports the activity, and asks signed-out visitors for an account first', async () => {
    mockGate.mockResolvedValue(false);
    await openActivity(activity());
    await fireEvent.press(screen.getByRole('link', { name: 'Signaler cette activité' }));
    expect(mockGate).toHaveBeenCalledWith('join');
    expect(screen.queryByRole('radio', { name: 'Autre' })).toBeNull();
    mockGate.mockResolvedValue(true);
    await fireEvent.press(screen.getByRole('link', { name: 'Signaler cette activité' }));
    await sendReport('Lieu dangereux ou inadapté');
    expect(mReport).toHaveBeenCalledWith('activity', 'act1', 'unsafe_place', undefined);
  });

  it('activity page: reports the organiser, except to the organiser themselves', async () => {
    await openActivity(activity());
    await fireEvent.press(screen.getByRole('button', { name: 'Signaler cette personne' }));
    await sendReport('Comportement inapproprié');
    expect(mReport).toHaveBeenCalledWith('user', 'org1', 'inappropriate_behaviour', undefined);
    await screen.unmount();
    await openActivity(activity({ isOrganiser: true, organiser: { id: 'me', firstName: 'Moi', photoUrl: null } }));
    expect(screen.queryByRole('button', { name: 'Signaler cette personne' })).toBeNull();
  });

  it('session row: reports the session', async () => {
    await openActivity(activity());
    await fireEvent.press(screen.getByRole('link', { name: 'Signaler cette séance' }));
    await sendReport("N'a pas eu lieu");
    expect(mReport).toHaveBeenCalledWith('session', 's1', 'did_not_happen', undefined);
  });

  const withAttendees = (over: Partial<ActivityPage> = {}) =>
    activity({
      myStatus: 'member',
      nextSessions: [
        session({
          attendees: [
            { id: 'u9', firstName: 'Camille', photoUrl: null },
            { id: 'me', firstName: 'Moi', photoUrl: null },
          ],
        }),
      ],
      ...over,
    });

  it('attendee long press offers report and block; report goes to that person', async () => {
    await openActivity(withAttendees());
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    const menu = within(screen.getByTestId('person-actions'));
    expect(menu.getByRole('button', { name: 'Bloquer' })).toBeTruthy();
    await fireEvent.press(menu.getByRole('button', { name: 'Signaler cette personne' }));
    await sendReport('Harcèlement');
    expect(mReport).toHaveBeenCalledWith('user', 'u9', 'harassment', undefined);
  });

  it('has no person actions on my own avatar', async () => {
    await openActivity(withAttendees());
    await fireEvent(screen.getByLabelText('Moi'), 'longPress');
    expect(screen.queryByTestId('person-actions')).toBeNull();
  });

  it('blocking an attendee asks for confirmation first', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openActivity(withAttendees());
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('person-actions')).getByRole('button', { name: 'Bloquer' }));
    expect(mBlock).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][0]).toBe('Bloquer Camille ?');
    expect(alert.mock.calls[0][1]).toBe('Vous ne verrez plus ses messages.');
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    expect(mBlock).toHaveBeenCalledWith('u9');
    alert.mockRestore();
  });

  it('blocking the organiser uses the warning that says it removes you', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openActivity(withAttendees({ organiser: { id: 'u9', firstName: 'Camille', photoUrl: null } }));
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('person-actions')).getByRole('button', { name: 'Bloquer' }));
    expect(alert.mock.calls[0][1]).toBe('Vous ne verrez plus ses messages et vous quitterez cette activité.');
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    expect(mBlock).toHaveBeenCalledWith('u9');
    expect(router.back).toHaveBeenCalled();
    expect(getActivity).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('replaces the route when there is no back after blocking the organiser', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    await openActivity(withAttendees({ organiser: { id: 'u9', firstName: 'Camille', photoUrl: null } }));
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('person-actions')).getByRole('button', { name: 'Bloquer' }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('a plain block reloads the page and stays', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openActivity(withAttendees());
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('person-actions')).getByRole('button', { name: 'Bloquer' }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    await waitFor(() => expect(getActivity).toHaveBeenCalledTimes(2));
    expect(router.back).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('locks the block confirmation against two presses in the same tick', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let resolve!: (v: unknown) => void;
    mBlock.mockReturnValue(new Promise((r) => (resolve = r)));
    await openActivity(withAttendees());
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('person-actions')).getByRole('button', { name: 'Bloquer' }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!;
    await act(async () => {
      void confirm();
      void confirm();
    });
    expect(mBlock).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ ok: true }));
    alert.mockRestore();
  });

  it('shows an error when blocking fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mBlock.mockResolvedValue({ ok: false, error: 'network' });
    await openActivity(withAttendees());
    await fireEvent(screen.getByLabelText('Camille'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('person-actions')).getByRole('button', { name: 'Bloquer' }));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === 'Bloquer Camille')!.onPress!());
    expect(alert.mock.calls[1][0]).toBe('Action impossible. Réessayez.');
    expect(router.back).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('offers report and block as accessibility actions on an attendee, without a long press', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openActivity(withAttendees());
    const attendee = screen.getByLabelText('Camille');
    expect(attendee.props.accessibilityActions).toEqual([
      { name: 'report', label: 'Signaler cette personne' },
      { name: 'block', label: 'Bloquer' },
    ]);
    await fireEvent(attendee, 'accessibilityAction', { nativeEvent: { actionName: 'block' } });
    expect(alert.mock.calls[0][0]).toBe('Bloquer Camille ?');
    await fireEvent(attendee, 'accessibilityAction', { nativeEvent: { actionName: 'report' } });
    await sendReport('Harcèlement');
    expect(mReport).toHaveBeenCalledWith('user', 'u9', 'harassment', undefined);
    alert.mockRestore();
  });

  it('association page: the report link opens the sheet; the claim button stays coming soon', async () => {
    mockParams = { id: 'as1' };
    (getAssociation as jest.Mock).mockResolvedValue({
      id: 'as1', name: 'Club des Lilas', purpose: null, city: 'Lyon', postcode: '69001', lon: 4.8, lat: 45.7,
      website: null, phone: null, email: null, openingHours: null, source: 'rna', verified: false, claimed: false,
      sourceLabel: null, attributionKeys: [], tags: [], activities: [], canWait: false, isWaiting: false,
    });
    await render(<Association />);
    await screen.findByText('Club des Lilas');
    await fireEvent.press(screen.getByLabelText('Signaler une erreur / Retirer cette fiche'));
    expect(screen.queryByText('Bientôt disponible')).toBeNull();
    await sendReport('Lieu dangereux ou inadapté', 'ferme');
    expect(mReport).toHaveBeenCalledWith('association', 'as1', 'unsafe_place', 'ferme');
  });

  it('collectif page: reports the collectif', async () => {
    mockParams = { id: 'c1' };
    const c: CollectifPage = {
      id: 'c1', name: 'Les Boulistes', description: null, townLabel: 'Lyon (69001)', lon: 4.83, lat: 45.76,
      organisers: [{ firstName: 'Rita', photoUrl: null, role: 'responsable' }], activities: [], myRole: null,
    };
    (getCollectif as jest.Mock).mockResolvedValue({ ok: true, collectif: c });
    (myInvitation as jest.Mock).mockResolvedValue({ ok: true, invited: false });
    await render(<CollectifScreen />);
    await screen.findByText('Les Boulistes');
    await fireEvent.press(screen.getByRole('button', { name: 'Signaler ce collectif' }));
    await sendReport('Faux ou spam');
    expect(mReport).toHaveBeenCalledWith('collectif', 'c1', 'fake_or_spam', undefined);
  });
});

describe('blocked screen', () => {
  it('asks a signed-out visitor for an account instead of showing an error', async () => {
    mockSession = { status: 'signed_out', userId: null };
    mockGate.mockResolvedValue(false);
    await render(<BlockedScreen />);
    await waitFor(() => expect(mockGate).toHaveBeenCalledWith('join'));
    expect(mList).not.toHaveBeenCalled();
    expect(screen.queryByText('Impossible de charger les personnes bloquées. Réessayez.')).toBeNull();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('shows the list when signed in', async () => {
    await render(<BlockedScreen />);
    expect(await screen.findByText('Aucune personne bloquée')).toBeTruthy();
    expect(mockGate).not.toHaveBeenCalled();
  });
});

describe('BlockedList', () => {
  it('shows the blocked people and unblocks one', async () => {
    mList.mockResolvedValue({
      ok: true,
      blocked: [{ userId: 'u1', firstName: 'Camille' }, { userId: 'u2', firstName: 'Théo' }],
    });
    await render(<BlockedList />);
    expect(await screen.findByText('Camille')).toBeTruthy();
    expect(screen.getByText('Théo')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Débloquer Camille' }));
    expect(mUnblock).toHaveBeenCalledWith('u1');
    await waitFor(() => expect(screen.queryByText('Camille')).toBeNull());
    expect(screen.getByText('Théo')).toBeTruthy();
  });

  it('keeps the person listed when unblocking fails', async () => {
    mList.mockResolvedValue({ ok: true, blocked: [{ userId: 'u1', firstName: 'Camille' }] });
    mUnblock.mockResolvedValue({ ok: false, error: 'network' });
    await render(<BlockedList />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Débloquer Camille' }));
    expect(await screen.findByText('Action impossible. Réessayez.')).toBeTruthy();
    expect(screen.getByText('Camille')).toBeTruthy();
  });

  it('says so when nobody is blocked', async () => {
    await render(<BlockedList />);
    expect(await screen.findByText('Aucune personne bloquée')).toBeTruthy();
  });

  it('offers a retry when the list cannot be read', async () => {
    mList.mockResolvedValueOnce({ ok: false, error: 'network' });
    await render(<BlockedList />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Aucune personne bloquée')).toBeTruthy();
  });
});
