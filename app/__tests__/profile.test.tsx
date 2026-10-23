import { Alert } from 'react-native';
import i18next from 'i18next';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Profile from '../src/app/(tabs)/profile';
import { initI18n } from '../src/i18n';
import { deleteMyAccount, exportMyData } from '../src/features/account/myData';
import { pickAndUploadAvatar } from '../src/features/account/avatar';
import { signOut } from '../src/features/account/auth';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));

const mockPush = jest.fn();
const mockFocusListeners = new Set<() => void>();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // Runs the effect on mount and again each time the test says the screen regained focus.
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => {
      cb();
      mockFocusListeners.add(cb);
      return () => {
        mockFocusListeners.delete(cb);
      };
    }, [cb]);
  },
}));

type Sess = {
  status: 'signed_out' | 'ready' | 'needs_profile' | 'loading';
  userId: string | null;
  profile: {
    firstName: string;
    language: 'fr' | 'en';
    photoUrl: string | null;
    bio: string | null;
    homeAreaLabel: string | null;
  } | null;
  error?: boolean;
};
const mockSignedIn: Sess = {
  status: 'ready',
  userId: 'u1',
  profile: { firstName: 'Ana', language: 'fr', photoUrl: null, bio: 'Bonjour', homeAreaLabel: 'Lyon (69001)' },
};
const mockSignedOut: Sess = { status: 'signed_out', userId: null, profile: null };
let mockCurrent: Sess = mockSignedIn;
const mockListeners = new Set<() => void>();
const mockRefresh = jest.fn(async () => 'ready');
function mockSetSession(s: Sess) {
  mockCurrent = s;
  mockListeners.forEach((l) => l());
}
jest.mock('../src/features/account/useSession', () => {
  const React = require('react');
  return {
    useSession: () => {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const l = () => force((n: number) => n + 1);
        mockListeners.add(l);
        return () => {
          mockListeners.delete(l);
        };
      }, []);
      return { error: false, ...mockCurrent, refresh: mockRefresh };
    },
  };
});

const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({
  useRequireAccount: () => mockGate,
}));

jest.mock('../src/features/account/myData', () => ({
  exportMyData: jest.fn(),
  deleteMyAccount: jest.fn(),
}));
jest.mock('../src/features/account/avatar', () => ({ pickAndUploadAvatar: jest.fn() }));
jest.mock('../src/features/explore/components/LocationPicker', () => {
  const { Pressable, Text } = require('react-native');
  return {
    LocationPicker: ({ onTown, onGps, onCancel }: any) => (
      <>
        <Pressable accessibilityRole="button" onPress={() => onTown({ label: 'Nantes (44000)', lon: 1.5534, lat: 47.2184 })}>
          <Text>choisir Nantes</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onGps()}>
          <Text>utiliser ma position</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text>annuler le choix</Text>
        </Pressable>
      </>
    ),
  };
});
const mockMine = jest.fn();
const mockCreateCollectif = jest.fn();
jest.mock('../src/features/collectifs/api', () => ({
  myCollectifs: () => mockMine(),
  createCollectif: (...a: unknown[]) => mockCreateCollectif(...a),
}));
const mockCommune = jest.fn();
jest.mock('../src/features/account/homeArea', () => ({
  currentCommune: () => mockCommune(),
}));
jest.mock('../src/features/account/auth', () => ({
  signOut: jest.fn(async () => undefined),
  MAX_FIRST_NAME: 40,
}));

const mockEq = jest.fn(async (..._a: unknown[]): Promise<{ error: { message: string } | null }> => ({ error: null }));
const mockUpdate = jest.fn((_patch: unknown) => ({ eq: mockEq }));
jest.mock('../src/lib/supabase', () => ({
  supabase: { from: () => ({ update: (p: unknown) => mockUpdate(p) }) },
}));

const mockDelete = deleteMyAccount as jest.Mock;
const mockExport = exportMyData as jest.Mock;
const mockPick = pickAndUploadAvatar as jest.Mock;

const CONFIRM = 'Supprimer définitivement votre compte et toutes vos données ?';

beforeAll(async () => {
  await initI18n();
});
afterEach(async () => {
  await i18next.changeLanguage('fr');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent = mockSignedIn;
  mockGate.mockResolvedValue(false);
  mockMine.mockResolvedValue({ ok: true, collectifs: [] });
});

it('signed out shows Se connecter, language and privacy but no Mes données', async () => {
  mockCurrent = mockSignedOut;
  await render(<Profile />);
  expect(screen.getByText('Se connecter')).toBeTruthy();
  expect(screen.getByText('Politique de confidentialité')).toBeTruthy();
  expect(screen.getByText('English')).toBeTruthy();
  expect(screen.queryByText('Mes données')).toBeNull();
  await fireEvent.press(screen.getByText('Se connecter'));
  expect(mockGate).toHaveBeenCalledWith();
});

it('signed in shows the first name and Mes données', async () => {
  await render(<Profile />);
  expect(screen.getByDisplayValue('Ana')).toBeTruthy();
  expect(screen.getByText('Mes données')).toBeTruthy();
  expect(screen.getByText('Télécharger mes données')).toBeTruthy();
  expect(screen.getByText('Se déconnecter')).toBeTruthy();
  expect(screen.getByText('Changer la photo')).toBeTruthy();
});

describe('mes collectifs', () => {
  it('lists my collectifs and opens one', async () => {
    mockMine.mockResolvedValue({
      ok: true,
      collectifs: [{ id: 'c1', name: 'Les Boulistes', townLabel: 'Lyon (69001)', role: 'responsable' }],
    });
    await render(<Profile />);
    await fireEvent.press(await screen.findByText('Les Boulistes'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/collectifs/[id]', params: { id: 'c1' } });
  });

  it('refreshes the list when the screen regains focus', async () => {
    await render(<Profile />);
    await screen.findByText("Vous n'organisez aucun collectif pour l'instant.");
    mockMine.mockResolvedValue({
      ok: true,
      collectifs: [{ id: 'c2', name: 'Les Joueurs', townLabel: 'Lyon', role: 'organiser' }],
    });
    await act(async () => {
      mockFocusListeners.forEach((l) => l());
    });
    await screen.findByText('Les Joueurs');
    expect(screen.queryByText("Vous n'organisez aucun collectif pour l'instant.")).toBeNull();
  });

  it('says so when I organise none and offers to create one', async () => {
    await render(<Profile />);
    await screen.findByText("Vous n'organisez aucun collectif pour l'instant.");
    expect(screen.getByText('Mes collectifs')).toBeTruthy();
    expect(screen.getByText('Créer un collectif')).toBeTruthy();
  });

  it('creates a collectif and opens its page', async () => {
    mockCreateCollectif.mockResolvedValue({ ok: true, id: 'c9' });
    await render(<Profile />);
    await fireEvent.press(await screen.findByText('Créer un collectif'));
    await fireEvent.changeText(screen.getByLabelText('Nom du collectif'), 'Les Joueurs');
    await fireEvent.press(screen.getByText('choisir Nantes'));
    await fireEvent.press(screen.getByLabelText('Créer le collectif'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/collectifs/[id]', params: { id: 'c9' } }));
  });

  it('shows no collectifs section when signed out', async () => {
    mockCurrent = mockSignedOut;
    await render(<Profile />);
    expect(screen.queryByText('Mes collectifs')).toBeNull();
  });
});

it('opens the interests screen and the privacy policy', async () => {
  await render(<Profile />);
  await fireEvent.press(screen.getByText("Mes centres d'intérêt"));
  expect(mockPush).toHaveBeenCalledWith('/interests');
  await fireEvent.press(screen.getByText('Politique de confidentialité'));
  expect(mockPush).toHaveBeenCalledWith('/privacy');
});

it('asks for confirmation with the exact copy; Annuler does nothing', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Supprimer mon compte'));
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, , buttons] = alert.mock.calls[0];
  expect(title).toBe(CONFIRM);
  expect(buttons?.map((b) => b.text)).toEqual(['Annuler', 'Supprimer']);
  await act(async () => {
    buttons?.[0].onPress?.();
  });
  expect(mockDelete).not.toHaveBeenCalled();
  expect(screen.getByText('Mes données')).toBeTruthy();
});

it('Supprimer deletes the account and returns to the signed-out Profil', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockDelete.mockImplementation(async () => {
    mockSetSession(mockSignedOut);
    return { ok: true };
  });
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Supprimer mon compte'));
  await act(async () => {
    alert.mock.calls[0][2]?.[1].onPress?.();
  });
  expect(mockDelete).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByText('Se connecter')).toBeTruthy());
  expect(screen.queryByText('Mes données')).toBeNull();
});

it('shows an error and stays signed in when the deletion fails', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockDelete.mockResolvedValue({ ok: false });
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Supprimer mon compte'));
  await act(async () => {
    alert.mock.calls[0][2]?.[1].onPress?.();
  });
  expect(await screen.findByText('Suppression impossible. Réessayez.')).toBeTruthy();
  expect(screen.getByText('Mes données')).toBeTruthy();
});

it('downloads my data and reports a failure', async () => {
  mockExport.mockResolvedValueOnce({ ok: true, path: 'x' }).mockResolvedValueOnce({ ok: false });
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Télécharger mes données'));
  await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('Impossible de préparer vos données. Réessayez.')).toBeNull();
  await fireEvent.press(screen.getByText('Télécharger mes données'));
  expect(await screen.findByText('Impossible de préparer vos données. Réessayez.')).toBeTruthy();
});

it('blank first name shows the error and saves nothing', async () => {
  await render(<Profile />);
  await fireEvent.changeText(screen.getByDisplayValue('Ana'), '   ');
  await fireEvent.press(screen.getByText('Enregistrer'));
  expect(await screen.findByText('Entrez un prénom de 40 caractères au maximum.')).toBeTruthy();
  expect(mockUpdate).not.toHaveBeenCalled();
});

it('saves the trimmed first name and bio, then refreshes the session', async () => {
  await render(<Profile />);
  await fireEvent.changeText(screen.getByDisplayValue('Ana'), '  Anaïs ');
  await fireEvent.press(screen.getByText('Enregistrer'));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  expect(mockUpdate).toHaveBeenCalledWith({ first_name: 'Anaïs', bio: 'Bonjour' });
  expect(mockEq).toHaveBeenCalledWith('id', 'u1');
  expect(await screen.findByText('Enregistré')).toBeTruthy();
});

it('shows too_large for an oversized photo', async () => {
  mockPick.mockResolvedValue({ ok: false, error: 'too_large' });
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Changer la photo'));
  expect(mockPick).toHaveBeenCalledWith('u1');
  expect(await screen.findByText('Cette photo est trop lourde (1 Mo maximum).')).toBeTruthy();
});

it('refreshes the session after a successful photo upload', async () => {
  mockPick.mockResolvedValue({ ok: true, url: 'https://x/a.jpg?v=1' });
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Changer la photo'));
  await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
});

it('surfaces a failed language update on the profile', async () => {
  mockEq.mockResolvedValueOnce({ error: { message: 'x' } });
  await render(<Profile />);
  await fireEvent.press(screen.getByText('English'));
  expect(await screen.findByText('Could not save the language. Try again.')).toBeTruthy();
  expect(mockUpdate).toHaveBeenCalledWith({ language: 'en' });
});

it('signs out', async () => {
  await render(<Profile />);
  await fireEvent.press(screen.getByText('Se déconnecter'));
  expect(signOut).toHaveBeenCalled();
});

describe('home area', () => {
  it('shows the saved town with Changer and Retirer', async () => {
    await render(<Profile />);
    expect(screen.getByText('Lyon (69001)')).toBeTruthy();
    expect(screen.getByText('Changer')).toBeTruthy();
    expect(screen.getByText('Retirer')).toBeTruthy();
  });

  it('Changer opens the picker; choosing a town saves its centre and refreshes', async () => {
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Changer'));
    await fireEvent.press(screen.getByText('choisir Nantes'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        home_area: 'SRID=4326;POINT(1.5534 47.2184)',
        home_area_label: 'Nantes (44000)',
      }),
    );
    expect(mockEq).toHaveBeenCalledWith('id', 'u1');
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(screen.queryByText('choisir Nantes')).toBeNull();
  });

  it('the GPS choice is turned into a commune before saving', async () => {
    mockCommune.mockResolvedValue({ label: 'Paris (75001)', lon: 2.3488, lat: 48.8534 });
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Changer'));
    await fireEvent.press(screen.getByText('utiliser ma position'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        home_area: 'SRID=4326;POINT(2.3488 48.8534)',
        home_area_label: 'Paris (75001)',
      }),
    );
  });

  it('a GPS position that cannot be resolved saves nothing', async () => {
    mockCommune.mockResolvedValue('denied');
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Changer'));
    await fireEvent.press(screen.getByText('utiliser ma position'));
    await waitFor(() => expect(mockCommune).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('Retirer clears the area and its label', async () => {
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Retirer'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ home_area: null, home_area_label: null }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('shows an error when the update fails', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'x' } });
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Retirer'));
    expect(await screen.findByText('Impossible de modifier votre zone. Réessayez.')).toBeTruthy();
  });

  it('shows a placeholder and no Retirer when none is set', async () => {
    mockCurrent = { ...mockSignedIn, profile: { ...mockSignedIn.profile!, homeAreaLabel: null } };
    await render(<Profile />);
    expect(screen.getByText('Non renseignée')).toBeTruthy();
    expect(screen.queryByText('Retirer')).toBeNull();
  });
});

describe('needs_profile', () => {
  beforeEach(() => {
    mockCurrent = { status: 'needs_profile', userId: 'u1', profile: null };
  });

  it('offers to finish sign-up, sign out and delete the account', async () => {
    await render(<Profile />);
    expect(screen.getByText('Terminer mon inscription')).toBeTruthy();
    expect(screen.getByText('Se déconnecter')).toBeTruthy();
    expect(screen.getByText('Supprimer mon compte')).toBeTruthy();
    expect(screen.queryByText('Se connecter')).toBeNull();
    await fireEvent.press(screen.getByText('Terminer mon inscription'));
    expect(mockGate).toHaveBeenCalledWith();
  });

  it('signs out', async () => {
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Se déconnecter'));
    expect(signOut).toHaveBeenCalled();
  });

  it('deletes after the same confirmation as the signed-in screen', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockDelete.mockResolvedValue({ ok: true });
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Supprimer mon compte'));
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe(CONFIRM);
    expect(buttons?.map((b) => b.text)).toEqual(['Annuler', 'Supprimer']);
    await act(async () => {
      buttons?.[1].onPress?.();
    });
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe('offline', () => {
  it('shows a retry state instead of the signed-out view when the session cannot be read', async () => {
    mockCurrent = { status: 'loading', userId: null, profile: null, error: true };
    await render(<Profile />);
    expect(screen.getByText('Connexion impossible.')).toBeTruthy();
    expect(screen.queryByText('Se connecter')).toBeNull();
    await fireEvent.press(screen.getByText('Réessayer'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});
