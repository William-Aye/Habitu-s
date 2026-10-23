import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { initI18n } from '../src/i18n';
import ActivityScreen from '../src/app/activites/[id]';
import {
  activityRoster,
  archiveActivity,
  decideJoinRequest,
  getActivity,
  joinActivity,
  leaveActivity,
  setAttendance,
  setWelcomeMember,
  updateSession,
} from '../src/features/activities/api';
import { addSessionToCalendar } from '../src/features/activities/calendar';
import { shareActivity } from '../src/features/activities/share';
import { askForPush } from '../src/features/notifications/registerPush';
import type { ActivityPage, SessionInfo } from '../src/features/activities/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
const mockParams: { id: string; reminder?: string } = { id: 'act1' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-calendar/legacy', () => ({ createEventInCalendarAsync: jest.fn() }));
jest.mock('../src/features/explore/components/TownMap', () => ({ TownMap: () => null }));
jest.mock('../src/features/activities/api', () => ({
  getActivity: jest.fn(),
  joinActivity: jest.fn(),
  leaveActivity: jest.fn(),
  setAttendance: jest.fn(),
  updateSession: jest.fn(),
  decideJoinRequest: jest.fn(),
  setWelcomeMember: jest.fn(),
  archiveActivity: jest.fn(),
  activityRoster: jest.fn(),
}));
jest.mock('../src/features/notifications/registerPush', () => ({ askForPush: jest.fn(async () => {}) }));
const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => mockGate }));
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ status: 'ready', userId: 'me', profile: { firstName: 'Moi' } }),
}));

const mockGet = getActivity as jest.Mock;
const ok = { ok: true };

const IN_3_DAYS = new Date(Date.now() + 3 * 86_400_000).toISOString();

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's1', startsAt: IN_3_DAYS, placeLabel: 'Café des Arts', isDiscovery: false, status: 'scheduled',
    confirmedCount: 4, isFull: false, myAttendance: null, ...over,
  };
}
function activity(over: Partial<ActivityPage> = {}): ActivityPage {
  return {
    id: 'act1', title: 'Jeux de société', description: 'Une soirée conviviale',
    category: { id: 'c', slug: 'jeux', nameFr: 'Jeux', nameEn: 'Games', icon: 'dice' }, tags: [],
    organiser: { firstName: 'Olivier', photoUrl: null }, organisedBy: null, placeLabel: 'Café des Arts',
    lon: 4.85, lat: 45.77, recurrence: { kind: 'weekly' }, startDate: '2026-10-20', startTime: '19:00:00',
    durationMinutes: 120, timezone: 'Europe/Paris', maxSize: null, newcomerFriendly: true,
    approvalMode: 'open', publishedAt: '2026-10-01T00:00:00Z', archivedAt: null, isOrganiser: false,
    myStatus: 'none', nextSessions: [session()], ...over,
  };
}
function show(a: ActivityPage | null) {
  mockGet.mockResolvedValue({ ok: true, activity: a });
}
async function open(a: ActivityPage | null) {
  show(a);
  await render(<ActivityScreen />);
  await screen.findByText(a ? a.title : "Cette activité n'est plus disponible");
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockResolvedValue(false);
  (joinActivity as jest.Mock).mockResolvedValue({ ok: true, status: 'member' });
  (leaveActivity as jest.Mock).mockResolvedValue(ok);
  (setAttendance as jest.Mock).mockResolvedValue(ok);
  (updateSession as jest.Mock).mockResolvedValue(ok);
  (decideJoinRequest as jest.Mock).mockResolvedValue(ok);
  (setWelcomeMember as jest.Mock).mockResolvedValue(ok);
  (archiveActivity as jest.Mock).mockResolvedValue(ok);
  (activityRoster as jest.Mock).mockResolvedValue({ ok: true, people: [] });
  (createEventInCalendarAsync as jest.Mock).mockResolvedValue({ action: 'saved' });
});

it('shows counts and Rejoindre to a visitor, and Rejoindre opens the gate', async () => {
  await open(activity());
  expect(screen.getByText('4 confirmés')).toBeTruthy();
  expect(screen.queryByText('Je serai là')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Rejoindre'));
  expect(mockGate).toHaveBeenCalledWith('join');
  expect(joinActivity).not.toHaveBeenCalled();
});

it('joins once signed in and shows the member state', async () => {
  mockGate.mockResolvedValue(true);
  await open(activity());
  mockGet.mockResolvedValue({ ok: true, activity: activity({ myStatus: 'member' }) });
  await fireEvent.press(screen.getByLabelText('Rejoindre'));
  expect(joinActivity).toHaveBeenCalledWith('act1');
  await screen.findByLabelText("Quitter l'activité");
});

it('shows Demande envoyée to a pending applicant', async () => {
  await open(activity({ myStatus: 'pending', approvalMode: 'approval' }));
  expect(screen.getByText('Demande envoyée')).toBeTruthy();
  expect(screen.queryByLabelText('Rejoindre')).toBeNull();
});

it('lets a member confirm, then shows Confirmé, the guest toggle and the calendar', async () => {
  await open(activity({ myStatus: 'member', welcomeFirstName: 'Sophie', myPastAttendanceCount: 0 }));
  mockGet.mockResolvedValue({
    ok: true,
    activity: activity({
      myStatus: 'member', welcomeFirstName: 'Sophie', myPastAttendanceCount: 0,
      nextSessions: [session({ myAttendance: { status: 'confirmed', guestCount: 0 }, confirmedCount: 5 })],
    }),
  });
  await fireEvent.press(screen.getAllByText('Je serai là')[0]);
  expect(setAttendance).toHaveBeenCalledWith('s1', 'confirmed', 0);
  expect(askForPush).toHaveBeenCalledTimes(1);
  await screen.findByText('Confirmé');
  expect(screen.getByText('À votre arrivée, demandez Sophie')).toBeTruthy();
  await fireEvent.press(screen.getByRole('switch', { name: /Je viens avec quelqu'un/ }));
  expect(setAttendance).toHaveBeenLastCalledWith('s1', 'confirmed', 1);
  await fireEvent.press(screen.getByLabelText(/Ajouter la séance/));
  await waitFor(() => expect(createEventInCalendarAsync).toHaveBeenCalled());
});

it('shows Complet when the session turns out to be full', async () => {
  (setAttendance as jest.Mock).mockResolvedValue({ ok: false, error: 'session_full' });
  await open(activity({ myStatus: 'member' }));
  await fireEvent.press(screen.getAllByText('Je serai là')[0]);
  await screen.findByText('Complet');
  expect(askForPush).not.toHaveBeenCalled();
});

it('shows Complet from the data and hides Je serai là', async () => {
  await open(activity({ myStatus: 'member', nextSessions: [session({ isFull: true, confirmedCount: 8 })] }));
  expect(screen.getByText('Complet')).toBeTruthy();
  expect(screen.queryByText('Je serai là')).toBeNull();
});

it('shows the late-cancel notice after cancelling within 2 hours', async () => {
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  await open(activity({
    myStatus: 'member',
    nextSessions: [session({ startsAt: soon, myAttendance: { status: 'confirmed', guestCount: 0 } })],
  }));
  mockGet.mockResolvedValue({
    ok: true,
    activity: activity({
      myStatus: 'member',
      nextSessions: [session({ startsAt: soon, myAttendance: { status: 'cancelled_late', guestCount: 0 } })],
    }),
  });
  await fireEvent.press(screen.getByLabelText(/Annuler ma venue/));
  expect(setAttendance).toHaveBeenCalledWith('s1', 'cancelled', 0);
  await screen.findByText(/Annulation tardive/);
});

it('never shows attendee names to a non-member', async () => {
  await open(activity());
  expect(screen.queryByText('Mia')).toBeNull();
  expect(screen.queryByText('Participants confirmés')).toBeNull();
});

it('shows attendee first names when the page returns them', async () => {
  await open(activity({
    myStatus: 'member',
    nextSessions: [session({ attendees: [{ firstName: 'Mia', photoUrl: null }, { firstName: 'Marc', photoUrl: null }] })],
  }));
  expect(screen.getByText('Mia')).toBeTruthy();
  expect(screen.getByText('Marc')).toBeTruthy();
});

it('lets an organiser accept a request', async () => {
  (activityRoster as jest.Mock).mockResolvedValue({
    ok: true,
    people: [{ userId: 'u9', firstName: 'Paula', photoUrl: null, status: 'pending' }],
  });
  await open(activity({ isOrganiser: true, myStatus: 'none', approvalMode: 'approval' }));
  await screen.findByText('Paula');
  (activityRoster as jest.Mock).mockResolvedValue({ ok: true, people: [] });
  await fireEvent.press(screen.getByLabelText('Accepter la demande de Paula'));
  expect(decideJoinRequest).toHaveBeenCalledWith('act1', 'u9', true);
  await screen.findByText('Aucune demande en attente');
});

it('lets an organiser change a session time', async () => {
  await open(activity({ isOrganiser: true }));
  await fireEvent.press(screen.getByLabelText('Modifier la séance'));
  await fireEvent.changeText(screen.getByLabelText('Date (AAAA-MM-JJ)'), '2030-01-15');
  await fireEvent.changeText(screen.getByLabelText('Heure (HH:MM)'), '20:30');
  await fireEvent.press(screen.getByLabelText('Enregistrer'));
  // 20:30 in Paris in January is 19:30 UTC.
  expect(updateSession).toHaveBeenCalledWith('s1', expect.objectContaining({ startsAt: '2030-01-15T19:30:00.000Z' }));
});

it('rejects an invalid session time without calling the API', async () => {
  await open(activity({ isOrganiser: true }));
  await fireEvent.press(screen.getByLabelText('Modifier la séance'));
  await fireEvent.changeText(screen.getByLabelText('Heure (HH:MM)'), '25:99');
  await fireEvent.press(screen.getByLabelText('Enregistrer'));
  expect(updateSession).not.toHaveBeenCalled();
  expect(screen.getByText(/Date ou heure invalide/)).toBeTruthy();
});

it('lets an organiser mark a discovery session and cancel it after confirming', async () => {
  await open(activity({ isOrganiser: true }));
  await fireEvent.press(screen.getByLabelText('Marquer comme séance découverte'));
  expect(updateSession).toHaveBeenCalledWith('s1', { isDiscovery: true });
  await fireEvent.press(screen.getByLabelText('Annuler la séance'));
  expect(updateSession).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByLabelText("Confirmer l'annulation de la séance"));
  expect(updateSession).toHaveBeenLastCalledWith('s1', { status: 'cancelled_by_organiser' });
});

it('lets an organiser archive after a confirmation', async () => {
  await open(activity({ isOrganiser: true }));
  await fireEvent.press(screen.getByLabelText("Archiver l'activité"));
  expect(archiveActivity).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByLabelText('Oui, archiver'));
  expect(archiveActivity).toHaveBeenCalledWith('act1');
});

it('lets an organiser choose the welcome person', async () => {
  (activityRoster as jest.Mock).mockResolvedValue({
    ok: true,
    people: [{ userId: 'u2', firstName: 'Mia', photoUrl: null, status: 'member' }],
  });
  await open(activity({ isOrganiser: true, welcomeFirstName: null }));
  await fireEvent.press(await screen.findByLabelText("Personne d'accueil : Mia"));
  expect(setWelcomeMember).toHaveBeenCalledWith('act1', 'u2');
});

it('hides organiser tools from members', async () => {
  await open(activity({ myStatus: 'member' }));
  expect(screen.queryByLabelText("Archiver l'activité")).toBeNull();
  expect(activityRoster).not.toHaveBeenCalled();
});

it('shows a cancelled session without attendance buttons', async () => {
  await open(activity({ myStatus: 'member', nextSessions: [session({ status: 'cancelled_by_organiser' })] }));
  expect(screen.getByText('Séance annulée')).toBeTruthy();
  expect(screen.queryByText('Je serai là')).toBeNull();
});

it('says the activity is unavailable when archived for a visitor', async () => {
  await open(null);
  expect(screen.getByText("Cette activité n'est plus disponible")).toBeTruthy();
});

it('links the collectif with its label', async () => {
  await open(activity({ organisedBy: { kind: 'collectif', id: 'k1', name: 'Les Joueurs' } }));
  expect(screen.getByText('Collectif — sans statut juridique')).toBeTruthy();
  expect(screen.getByLabelText('Voir le collectif Les Joueurs')).toBeTruthy();
});

it('shares through the system sheet', async () => {
  const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  await open(activity());
  await fireEvent.press(screen.getByLabelText('Partager'));
  await waitFor(() => expect(spy).toHaveBeenCalled());
});

describe('shareActivity', () => {
  const OLD = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = OLD;
  });
  it('builds the URL from the environment', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habitues.example/';
    await shareActivity('abc', 'Go du mardi');
    expect(spy).toHaveBeenCalledWith({ message: 'Go du mardi sur Habitués : https://habitues.example/activites/abc' });
  });
  it('falls back to the app link', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    process.env.EXPO_PUBLIC_WEB_BASE_URL = '';
    await shareActivity('abc', 'Go');
    expect(spy).toHaveBeenCalledWith({ message: 'Go sur Habitués : friendapp://activites/abc' });
  });
});

describe('addSessionToCalendar', () => {
  const s = { startsAt: IN_3_DAYS, placeLabel: 'Café' };
  const a = { title: 'Go', durationMinutes: 90, timezone: 'Europe/Paris' };
  it('fills the event and reports added', async () => {
    expect(await addSessionToCalendar(s, a)).toBe('added');
    const arg = (createEventInCalendarAsync as jest.Mock).mock.calls[0][0];
    expect(arg.title).toBe('Go');
    expect(arg.location).toBe('Café');
    expect(arg.endDate.getTime() - arg.startDate.getTime()).toBe(90 * 60_000);
  });
  it('reports cancelled', async () => {
    (createEventInCalendarAsync as jest.Mock).mockResolvedValue({ action: 'canceled' });
    expect(await addSessionToCalendar(s, a)).toBe('cancelled');
  });
  it('reports unavailable when the calendar throws', async () => {
    (createEventInCalendarAsync as jest.Mock).mockRejectedValue(new Error('no calendar'));
    expect(await addSessionToCalendar(s, a)).toBe('unavailable');
  });
});

it('tells the member when the calendar is unavailable', async () => {
  (createEventInCalendarAsync as jest.Mock).mockRejectedValue(new Error('no calendar'));
  await open(activity({
    myStatus: 'member',
    nextSessions: [session({ myAttendance: { status: 'confirmed', guestCount: 0 } })],
  }));
  await fireEvent.press(screen.getByLabelText(/Ajouter la séance/));
  await screen.findByText("Impossible d'ouvrir l'agenda sur cet appareil.");
});

it('lets a member leave', async () => {
  await open(activity({ myStatus: 'member' }));
  mockGet.mockResolvedValue({ ok: true, activity: activity() });
  await fireEvent.press(screen.getByLabelText("Quitter l'activité"));
  expect(leaveActivity).toHaveBeenCalledWith('act1');
  await screen.findByLabelText('Rejoindre');
});

it('does not show the welcome hint to a returning member', async () => {
  await open(activity({
    myStatus: 'member', welcomeFirstName: 'Sophie', myPastAttendanceCount: 3,
    nextSessions: [session({ myAttendance: { status: 'confirmed', guestCount: 0 } })],
  }));
  expect(screen.queryByText(/demandez/)).toBeNull();
});

it('shows the welcome hint only on the earliest confirmed session', async () => {
  const later = new Date(Date.now() + 10 * 86_400_000).toISOString();
  await open(activity({
    myStatus: 'member', welcomeFirstName: 'Sophie', myPastAttendanceCount: 0,
    nextSessions: [
      session({ myAttendance: { status: 'confirmed', guestCount: 0 } }),
      session({ id: 's2', startsAt: later, myAttendance: { status: 'confirmed', guestCount: 0 } }),
    ],
  }));
  expect(screen.getAllByText('À votre arrivée, demandez Sophie')).toHaveLength(1);
});

it('says so when the requests cannot be loaded, instead of claiming there are none', async () => {
  (activityRoster as jest.Mock).mockResolvedValue({ ok: false, error: 'network' });
  await open(activity({ isOrganiser: true }));
  await screen.findByText('Connexion impossible. Vérifiez votre réseau et réessayez.');
  expect(screen.queryByText('Aucune demande en attente')).toBeNull();
});

it('reseeds the session editor from the session each time it opens', async () => {
  await open(activity({ isOrganiser: true }));
  await fireEvent.press(screen.getByLabelText('Modifier la séance'));
  await fireEvent.changeText(screen.getByLabelText('Heure (HH:MM)'), '23:45');
  await fireEvent.press(screen.getByLabelText('Modifier la séance'));
  await fireEvent.press(screen.getByLabelText('Modifier la séance'));
  expect(screen.getByLabelText('Heure (HH:MM)').props.value).not.toBe('23:45');
});

it('ignores a second tap on Rejoindre while the account gate is open', async () => {
  let resolveGate: (v: boolean) => void = () => {};
  mockGate.mockReturnValue(new Promise<boolean>((r) => { resolveGate = r; }));
  await open(activity());
  // The first tap stays pending on the gate, so it is not awaited until the gate closes.
  const first = fireEvent.press(screen.getByLabelText('Rejoindre'));
  await waitFor(() => expect(mockGate).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByLabelText('Rejoindre'));
  expect(mockGate).toHaveBeenCalledTimes(1);
  resolveGate(false);
  await first;
});

it('tells the user when a reminder answer could not be recorded', async () => {
  mockParams.reminder = 'failed';
  try {
    await open(activity({ myStatus: 'member' }));
    expect(
      await screen.findByText("Votre réponse n'a pas pu être enregistrée. Indiquez-la ci-dessous."),
    ).toBeTruthy();
  } finally {
    delete mockParams.reminder;
  }
});
