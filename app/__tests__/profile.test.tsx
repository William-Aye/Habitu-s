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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

type Sess = {
  status: 'signed_out' | 'ready';
  userId: string | null;
  profile: { firstName: string; language: 'fr' | 'en'; photoUrl: string | null; bio: string | null } | null;
};
const mockSignedIn: Sess = {
  status: 'ready',
  userId: 'u1',
  profile: { firstName: 'Ana', language: 'fr', photoUrl: null, bio: 'Bonjour' },
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
      return { ...mockCurrent, error: false, refresh: mockRefresh };
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
