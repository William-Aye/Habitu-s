import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import MyActivities from '../src/app/(tabs)/my-activities';
import { myActivities, setAttendance } from '../src/features/activities/api';
import { askForPush } from '../src/features/notifications/registerPush';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});
jest.mock('../src/features/activities/api', () => ({ myActivities: jest.fn(), setAttendance: jest.fn() }));
jest.mock('../src/features/notifications/registerPush', () => ({ askForPush: jest.fn(async () => {}) }));
const mockSession = { status: 'ready', userId: 'u1' };
jest.mock('../src/features/account/useSession', () => ({ useSession: () => mockSession }));

const mockMy = myActivities as jest.Mock;
const mockAttend = setAttendance as jest.Mock;

const session = (over = {}) => ({
  id: 's1',
  startsAt: '2026-11-03T18:00:00Z',
  placeLabel: 'Parc',
  isDiscovery: false,
  status: 'scheduled',
  confirmedCount: 2,
  isFull: false,
  myAttendance: null,
  ...over,
});
const activity = (over = {}) => ({
  id: 'a1',
  title: 'Marche douce',
  placeLabel: 'Parc',
  categoryIcon: 'footprints',
  isOrganiser: false,
  myStatus: 'member',
  nextSession: session(),
  ...over,
});

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.status = 'ready';
  mockAttend.mockResolvedValue({ ok: true });
});

describe('Mes activités', () => {
  it('shows the empty state with both actions', async () => {
    mockMy.mockResolvedValue({ ok: true, activities: [] });
    await render(<MyActivities />);
    expect(await screen.findByText("Aucune activité pour l'instant")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Créer une activité'));
    expect(router.push).toHaveBeenCalledWith('/activites/new');
    await fireEvent.press(screen.getByLabelText('Explorer'));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('lists organised and joined activities in their sections, including pending requests', async () => {
    mockMy.mockResolvedValue({
      ok: true,
      activities: [
        activity({ id: 'a1', title: 'Marche douce', isOrganiser: true }),
        activity({ id: 'a2', title: 'Aquarelle', nextSession: null }),
        activity({ id: 'a3', title: 'Echecs', myStatus: 'pending', nextSession: null }),
      ],
    });
    await render(<MyActivities />);
    expect(await screen.findByText("J'organise")).toBeTruthy();
    expect(screen.getByText('Je participe')).toBeTruthy();
    expect(screen.getByText('Marche douce')).toBeTruthy();
    expect(screen.getByText('Aquarelle')).toBeTruthy();
    expect(screen.getByText('Echecs')).toBeTruthy();
    expect(screen.getByText('Demande envoyée')).toBeTruthy();
    expect(screen.getAllByText('Aucune séance à venir')).toHaveLength(2);
  });

  it('opens an activity', async () => {
    mockMy.mockResolvedValue({ ok: true, activities: [activity()] });
    await render(<MyActivities />);
    await fireEvent.press(await screen.findByLabelText("Ouvrir l'activité Marche douce"));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'a1' } });
  });

  it('confirms the next session from the card, updates it and then asks for push', async () => {
    mockMy
      .mockResolvedValueOnce({ ok: true, activities: [activity()] })
      .mockResolvedValueOnce({
        ok: true,
        activities: [activity({ nextSession: session({ myAttendance: { status: 'confirmed', guestCount: 0 } }) })],
      });
    await render(<MyActivities />);
    await fireEvent.press((await screen.findAllByText('Je serai là'))[0]);
    expect(mockAttend).toHaveBeenCalledWith('s1', 'confirmed', 0);
    expect(await screen.findByText('Confirmé')).toBeTruthy();
    expect(screen.queryByText('Je serai là')).toBeNull();
    expect(askForPush).toHaveBeenCalledTimes(1);
  });

  it('does not ask for push when the confirmation fails', async () => {
    mockMy.mockResolvedValue({ ok: true, activities: [activity()] });
    mockAttend.mockResolvedValue({ ok: false, error: 'session_full' });
    await render(<MyActivities />);
    await fireEvent.press((await screen.findAllByText('Je serai là'))[0]);
    await waitFor(() => expect(mockAttend).toHaveBeenCalled());
    expect(await screen.findByText("Impossible d'enregistrer votre réponse. Réessayez.")).toBeTruthy();
    expect(askForPush).not.toHaveBeenCalled();
  });

  it('keeps the list and shows an inline error when the refresh after a confirmation fails', async () => {
    mockMy
      .mockResolvedValueOnce({ ok: true, activities: [activity()] })
      .mockResolvedValueOnce({ ok: false, error: 'network' });
    await render(<MyActivities />);
    await fireEvent.press((await screen.findAllByText('Je serai là'))[0]);
    expect(await screen.findByText('Impossible de charger vos activités. Réessayez.')).toBeTruthy();
    expect(screen.getByText('Marche douce')).toBeTruthy();
  });

  it('disables only the card being answered', async () => {
    mockMy.mockResolvedValue({
      ok: true,
      activities: [
        activity({ id: 'a1', title: 'Un' }),
        activity({ id: 'a2', title: 'Deux', nextSession: session({ id: 's2' }) }),
      ],
    });
    let release: (v: unknown) => void = () => {};
    mockAttend.mockReturnValue(new Promise((r) => (release = r)));
    await render(<MyActivities />);
    const buttons = await screen.findAllByLabelText(/Je serai là le/);
    const pressed = fireEvent.press(buttons[0]); // stays pending until the answer is released
    await waitFor(() => expect(mockAttend).toHaveBeenCalled());
    const after = screen.getAllByLabelText(/Je serai là le/);
    expect(after[0].props.accessibilityState?.disabled ?? after[0].props['aria-disabled']).toBeTruthy();
    expect(after[1].props.accessibilityState?.disabled).toBeFalsy();
    release({ ok: true });
    await pressed;
  });

  it('shows an error with a retry when loading fails', async () => {
    mockMy.mockResolvedValueOnce({ ok: false, error: 'network' });
    mockMy.mockResolvedValueOnce({ ok: true, activities: [] });
    await render(<MyActivities />);
    await fireEvent.press(await screen.findByLabelText('Réessayer'));
    expect(await screen.findByText("Aucune activité pour l'instant")).toBeTruthy();
  });
});
