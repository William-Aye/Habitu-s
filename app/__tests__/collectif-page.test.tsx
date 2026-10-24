import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { initI18n } from '../src/i18n';
import CollectifScreen from '../src/app/collectifs/[id]';
import {
  answerInvitation,
  deleteCollectif,
  getCollectif,
  inviteOrganiser,
  leaveCollectif,
  listCandidates,
  myInvitation,
  updateCollectif,
} from '../src/features/collectifs/api';
import { linkCollectifToAssociation, myVerifiedAssociations } from '../src/features/claims/api';
import type { CollectifPage } from '../src/features/activities/types';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'c1' }),
}));
const mockTownMap = jest.fn((_props: unknown) => null);
jest.mock('../src/features/explore/components/TownMap', () => ({ TownMap: (p: unknown) => mockTownMap(p) }));
jest.mock('../src/features/explore/components/LocationPicker', () => {
  const { Pressable, Text } = require('react-native');
  return {
    LocationPicker: ({ onTown }: any) => (
      <Pressable accessibilityRole="button" onPress={() => onTown({ label: 'Nantes (44000)', lon: 1.55, lat: 47.21 })}>
        <Text>choisir Nantes</Text>
      </Pressable>
    ),
  };
});
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

jest.mock('../src/features/claims/api', () => ({
  myVerifiedAssociations: jest.fn(),
  linkCollectifToAssociation: jest.fn(),
}));
const mockVerified = myVerifiedAssociations as jest.Mock;
const mockLink = linkCollectifToAssociation as jest.Mock;
const mockGet = getCollectif as jest.Mock;
const mockInvitation = myInvitation as jest.Mock;
const mockAnswer = answerInvitation as jest.Mock;
const mockInvite = inviteOrganiser as jest.Mock;
const mockCandidates = listCandidates as jest.Mock;
const mockUpdate = updateCollectif as jest.Mock;
const mockLeave = leaveCollectif as jest.Mock;
const mockDelete = deleteCollectif as jest.Mock;

const LABEL = 'Collectif — sans statut juridique';

function page(over: Partial<CollectifPage> = {}): CollectifPage {
  return {
    id: 'c1',
    name: 'Les Boulistes',
    description: 'On joue le dimanche',
    townLabel: 'Lyon (69001)',
    lon: 4.83,
    lat: 45.76,
    organisers: [
      { firstName: 'Rita', photoUrl: null, role: 'responsable' },
      { firstName: 'Oriane', photoUrl: null, role: 'organiser' },
    ],
    activities: [{ id: 'a1', title: 'Pétanque du dimanche', nextStartsAt: null }],
    myRole: null,
    ...over,
  };
}

async function show(c: CollectifPage | null, invited = false) {
  mockGet.mockResolvedValue({ ok: true, collectif: c });
  mockInvitation.mockResolvedValue({ ok: true, invited });
  await render(<CollectifScreen />);
  await screen.findByText(c ? c.name : "Ce collectif n'existe plus");
}

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.resetAllMocks();
  mockAnswer.mockResolvedValue({ ok: true });
  mockVerified.mockResolvedValue({ ok: true, associations: [] });
  mockLink.mockResolvedValue({ ok: true, moved: 2 });
  mockInvite.mockResolvedValue({ ok: true });
  mockUpdate.mockResolvedValue({ ok: true });
  mockLeave.mockResolvedValue({ ok: true });
  mockDelete.mockResolvedValue({ ok: true });
  mockCandidates.mockResolvedValue({
    ok: true,
    candidates: [{ userId: 'u2', firstName: 'Camille', photoUrl: null }],
  });
});

/** Presses the destructive button of the last confirmation shown. */
function confirmLast(spy: jest.SpyInstance) {
  const buttons = spy.mock.calls[spy.mock.calls.length - 1][2] as { style?: string; onPress?: () => void }[];
  return buttons.find((b) => b.style === 'destructive')!.onPress!();
}

it('always shows the no-legal-status label with the description, organisers and activities', async () => {
  await show(page());
  expect(screen.getByText(LABEL)).toBeTruthy();
  expect(screen.getByText('On joue le dimanche')).toBeTruthy();
  expect(screen.getByText('Rita')).toBeTruthy();
  expect(screen.getByText('Responsable')).toBeTruthy();
  expect(screen.getByText('Pétanque du dimanche')).toBeTruthy();
});

it('shows the town as a town-level map only', async () => {
  await show(page());
  expect(mockTownMap).toHaveBeenCalledWith({ lon: 4.83, lat: 45.76, label: 'Carte de Lyon (69001)' });
});

it('shows a visitor no edit, invite, create or leave controls', async () => {
  await show(page());
  for (const label of ['Modifier le collectif', 'Inviter un organisateur', 'Créer une activité', 'Quitter le collectif', 'Supprimer le collectif']) {
    expect(screen.queryByText(label)).toBeNull();
  }
});

it('opens an activity from the list', async () => {
  await show(page());
  await fireEvent.press(screen.getByText('Pétanque du dimanche'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/[id]', params: { id: 'a1', title: 'Pétanque du dimanche' } });
});

it('lets an organiser create an activity with this collectif selected', async () => {
  await show(page({ myRole: 'organiser' }));
  await fireEvent.press(screen.getByText('Créer une activité'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/activites/new', params: { collectif: 'c1' } });
  // An organiser who is not responsable cannot invite or delete.
  expect(screen.queryByText('Inviter un organisateur')).toBeNull();
  expect(screen.queryByText('Supprimer le collectif')).toBeNull();
  expect(screen.getByText('Modifier le collectif')).toBeTruthy();
});

it('accepting an invitation makes me an organiser', async () => {
  await show(page(), true);
  expect(screen.queryByText('Créer une activité')).toBeNull();
  mockGet.mockResolvedValue({ ok: true, collectif: page({ myRole: 'organiser' }) });
  mockInvitation.mockResolvedValue({ ok: true, invited: false });
  await fireEvent.press(screen.getByText('Accepter'));
  expect(mockAnswer).toHaveBeenCalledWith('c1', true);
  await screen.findByText('Créer une activité');
  expect(screen.queryByText('Accepter')).toBeNull();
});

it('declining an invitation removes the banner', async () => {
  await show(page(), true);
  await fireEvent.press(screen.getByText('Refuser'));
  expect(mockAnswer).toHaveBeenCalledWith('c1', false);
  await screen.findByText('Invitation refusée.');
  expect(screen.queryByText('Accepter')).toBeNull();
});

it('says so when the answer to an invitation is refused', async () => {
  mockAnswer.mockResolvedValue({ ok: false, error: 'not_allowed' });
  await show(page(), true);
  await fireEvent.press(screen.getByText('Accepter'));
  await screen.findByText(/Action impossible/);
  expect(screen.getByText('Accepter')).toBeTruthy();
});

it('the responsable invites a candidate', async () => {
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Inviter un organisateur'));
  expect(mockCandidates).toHaveBeenCalledWith('c1');
  await screen.findByText('Camille');
  await fireEvent.press(screen.getByLabelText('Inviter Camille'));
  expect(mockInvite).toHaveBeenCalledWith('c1', 'u2');
  await screen.findByText('Camille a été invité(e).');
  expect(screen.queryByLabelText('Inviter Camille')).toBeNull();
});

it('tells the responsable when the daily invitation limit is reached', async () => {
  mockInvite.mockResolvedValue({ ok: false, error: 'limit_reached' });
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Inviter un organisateur'));
  await screen.findByText('Camille');
  await fireEvent.press(screen.getByLabelText('Inviter Camille'));
  await screen.findByText(/Limite atteinte : vous pouvez inviter 10 personnes/);
});

it('explains when nobody can be invited yet', async () => {
  mockCandidates.mockResolvedValue({ ok: true, candidates: [] });
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Inviter un organisateur'));
  await screen.findByText(/Aucune personne à inviter/);
});

it('edits name, description and town', async () => {
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Modifier le collectif'));
  await fireEvent.changeText(screen.getByLabelText('Nom du collectif'), 'Boulistes de Lyon');
  await fireEvent.press(screen.getByLabelText('Changer de ville'));
  await fireEvent.press(screen.getByText('choisir Nantes'));
  mockGet.mockResolvedValue({ ok: true, collectif: page({ name: 'Boulistes de Lyon', myRole: 'responsable' }) });
  await fireEvent.press(screen.getByLabelText('Enregistrer'));
  await waitFor(() =>
    expect(mockUpdate).toHaveBeenCalledWith('c1', {
      name: 'Boulistes de Lyon',
      description: 'On joue le dimanche',
      town: { label: 'Nantes (44000)', lon: 1.55, lat: 47.21 },
    }),
  );
  await screen.findByText('Boulistes de Lyon');
});

it('refuses a name that is too short', async () => {
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Modifier le collectif'));
  await fireEvent.changeText(screen.getByLabelText('Nom du collectif'), 'ab');
  expect(screen.getByLabelText('Enregistrer').props.accessibilityState?.disabled).toBe(true);
});

it('the responsable deletes after the exact confirmation and returns to Profil', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Supprimer le collectif'));
  expect(alert.mock.calls[0][0]).toBe('Supprimer ce collectif ?');
  expect(alert.mock.calls[0][1]).toBe(
    'Les activités du collectif restent en ligne et affichent leur organisateur. Cette action est définitive.',
  );
  await confirmLast(alert);
  expect(mockDelete).toHaveBeenCalledWith('c1');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/profile'));
  alert.mockRestore();
});

it('keeps the page and says so when the deletion fails', async () => {
  mockDelete.mockResolvedValue({ ok: false, error: 'network' });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Supprimer le collectif'));
  await confirmLast(alert);
  await screen.findByText(/Connexion impossible/);
  expect(router.replace).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('tells the responsable who takes over when another organiser exists', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(page({ myRole: 'responsable' }));
  await fireEvent.press(screen.getByText('Quitter le collectif'));
  expect(alert.mock.calls[0][1]).toBe(
    "Le rôle de responsable passera à l'organisateur le plus ancien. Le collectif et ses activités restent en ligne.",
  );
  alert.mockRestore();
});

it('warns the sole responsable that leaving deletes the collectif', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(page({ myRole: 'responsable', organisers: [{ firstName: 'Rita', photoUrl: null, role: 'responsable' }] }));
  await fireEvent.press(screen.getByText('Quitter le collectif'));
  expect(alert.mock.calls[0][1]).toBe(
    'Vous êtes la seule personne à organiser : le collectif sera supprimé. Ses activités restent en ligne et affichent leur organisateur.',
  );
  alert.mockRestore();
});

it('shows a plain organiser the simple leave message', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(page({ myRole: 'organiser' }));
  await fireEvent.press(screen.getByText('Quitter le collectif'));
  expect(alert.mock.calls[0][1]).toBe("Vous n'en serez plus organisateur. Le collectif et ses activités restent en ligne.");
  alert.mockRestore();
});

it('marks the edit button busy while a write runs', async () => {
  let release: (v: unknown) => void = () => {};
  mockAnswer.mockReturnValue(new Promise((r) => (release = r)));
  await show(page({ myRole: 'organiser' }), false);
  expect(screen.getByLabelText('Modifier le collectif').props.accessibilityState).toEqual({ disabled: false, busy: false });
  release({ ok: true });
});

it('leaves the collectif after a confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await show(page({ myRole: 'organiser' }));
  await fireEvent.press(screen.getByText('Quitter le collectif'));
  await confirmLast(alert);
  expect(mockLeave).toHaveBeenCalledWith('c1');
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/profile'));
  alert.mockRestore();
});

it('says the collectif no longer exists when it was deleted meanwhile', async () => {
  await show(null);
  expect(screen.getByText("Ce collectif n'existe plus")).toBeTruthy();
});

it('offers a retry when the page cannot be loaded', async () => {
  mockGet.mockResolvedValueOnce({ ok: false, error: 'network' });
  mockInvitation.mockResolvedValue({ ok: true, invited: false });
  await render(<CollectifScreen />);
  await screen.findByText('Impossible de charger ce collectif. Réessayez.');
  mockGet.mockResolvedValue({ ok: true, collectif: page() });
  await fireEvent.press(screen.getByText('Réessayer'));
  await screen.findByText('Les Boulistes');
});

describe('linking the collectif to an association', () => {
  const LINK = 'Rattacher le collectif à cette association';
  const mine = { ok: true, associations: [{ id: 'as1', name: 'Club Boules' }, { id: 'as2', name: 'Les Joueurs' }] };

  it('is offered only to the responsable who has a verified association', async () => {
    mockVerified.mockResolvedValue(mine);
    await show(page({ myRole: 'responsable' }));
    expect(await screen.findByLabelText(LINK)).toBeTruthy();
  });

  it('is hidden without a verified association, for an organiser and for a visitor', async () => {
    await show(page({ myRole: 'responsable' }));
    expect(screen.queryByLabelText(LINK)).toBeNull();
    mockVerified.mockResolvedValue(mine);
    await show(page({ myRole: 'organiser' }));
    expect(screen.queryByLabelText(LINK)).toBeNull();
    expect(mockVerified).toHaveBeenCalledTimes(1);
    await show(page({ myRole: null }));
    expect(screen.queryByLabelText(LINK)).toBeNull();
  });

  it('lists the associations in a picker and calls the RPC when confirmed', async () => {
    mockVerified.mockResolvedValue(mine);
    await show(page({ myRole: 'responsable' }));
    await fireEvent.press(await screen.findByLabelText(LINK));
    expect(screen.getByLabelText('Les Joueurs')).toBeTruthy();
    expect(screen.getByLabelText('Confirmer le rattachement').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Club Boules'));
    await fireEvent.press(screen.getByLabelText('Confirmer le rattachement'));
    expect(mockLink).toHaveBeenCalledWith('c1', 'as1');
    expect(await screen.findByText('2 activités rattachées.')).toBeTruthy();
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(1));
  });

  it('shows an error when the link is refused', async () => {
    mockVerified.mockResolvedValue(mine);
    mockLink.mockResolvedValue({ ok: false, error: 'not_allowed' });
    await show(page({ myRole: 'responsable' }));
    await fireEvent.press(await screen.findByLabelText(LINK));
    await fireEvent.press(screen.getByLabelText('Club Boules'));
    await fireEvent.press(screen.getByLabelText('Confirmer le rattachement'));
    expect(await screen.findByText('Impossible de rattacher le collectif. Réessayez.')).toBeTruthy();
  });
});

it('signed out: organiser names are not sent, so only their number shows', async () => {
  await show(page({ organisers: [{ role: 'responsable' }, { role: 'organiser' }] as never }));
  expect(screen.getByText('2 organisateurs')).toBeTruthy();
  expect(screen.queryByText('Responsable')).toBeNull();
  expect(screen.queryByText('undefined')).toBeNull();
});

it('signed out with a single organiser: singular', async () => {
  await show(page({ organisers: [{ role: 'responsable' }] as never }));
  expect(screen.getByText('1 organisateur')).toBeTruthy();
});
