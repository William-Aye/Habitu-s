import { Platform } from 'react-native';
import i18next from 'i18next';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { initI18n } from '../src/i18n';
import { WebHeader } from '../src/features/web/WebHeader';
import Profile from '../src/app/(tabs)/profile';
import { deleteMyAccount, exportMyData } from '../src/features/account/myData';
import { signOut } from '../src/features/account/auth';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
  useRouter: () => ({ push: (...a: unknown[]) => mockPush(...a) }),
  useFocusEffect: jest.fn(),
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
};
const signedIn: Sess = {
  status: 'ready',
  userId: 'u1',
  profile: { firstName: 'Ana', language: 'fr', photoUrl: null, bio: null, homeAreaLabel: null },
};
let mockCurrent: Sess = signedIn;
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ error: false, refresh: jest.fn(async () => 'ready'), ...mockCurrent }),
}));
jest.mock('../src/features/account/AccountGate', () => ({ useRequireAccount: () => jest.fn() }));
jest.mock('../src/features/account/myData', () => ({
  exportMyData: jest.fn(),
  deleteMyAccount: jest.fn(),
  deleteMessagesInLeftActivities: jest.fn(),
}));
jest.mock('../src/features/account/auth', () => ({ signOut: jest.fn(async () => undefined), MAX_FIRST_NAME: 40 }));
jest.mock('../src/features/account/avatar', () => ({ pickAndUploadAvatar: jest.fn() }));
jest.mock('../src/lib/supabase', () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}));
// These hooks and components are app-only: they must never run on the web.
const mockNative = jest.fn();
jest.mock('../src/features/admin/useIsAdmin', () => ({ useAdminRole: () => (mockNative('admin'), 'other') }));
jest.mock('../src/features/safety/notices', () => ({
  useModerationUnread: () => (mockNative('notices'), { count: 0, refresh: jest.fn() }),
}));
jest.mock('../src/features/collectifs/MyCollectifs', () => ({ MyCollectifs: () => (mockNative('collectifs'), null) }));

beforeAll(async () => {
  await initI18n();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent = signedIn;
  process.env.EXPO_PUBLIC_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=x';
  jest.replaceProperty(Platform, 'OS', 'web');
});
afterEach(async () => {
  jest.restoreAllMocks();
  await i18next.changeLanguage('fr');
});

function setConfirm(answer: boolean) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.window) g.window = g;
  const confirm = jest.fn(() => answer);
  (g.window as Record<string, unknown>).confirm = confirm;
  return confirm;
}

describe('WebHeader account links', () => {
  it('signed in: Mon compte goes to /profile and Se déconnecter signs out', async () => {
    await render(<WebHeader />);
    await fireEvent.press(screen.getByRole('link', { name: 'Mon compte' }));
    expect(mockPush).toHaveBeenCalledWith('/profile');
    await fireEvent.press(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('signed out or loading: no account links', async () => {
    for (const status of ['signed_out', 'loading'] as const) {
      mockCurrent = { status, userId: null, profile: null };
      const { unmount } = await render(<WebHeader />);
      expect(screen.queryByText('Mon compte')).toBeNull();
      expect(screen.queryByText('Se déconnecter')).toBeNull();
      await unmount();
    }
  });

  it('an account without a finished profile still gets the links', async () => {
    mockCurrent = { status: 'needs_profile', userId: 'u1', profile: null };
    await render(<WebHeader />);
    expect(screen.getByText('Mon compte')).toBeTruthy();
  });

  it('is translated', async () => {
    await i18next.changeLanguage('en');
    await render(<WebHeader />);
    expect(screen.getByText('My account')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });
});

describe('/profile on the web', () => {
  it('shows first name, language, Mes données, feedback, privacy and sign out', async () => {
    await render(<Profile />);
    expect(screen.getByDisplayValue('Ana')).toBeTruthy();
    expect(screen.getByText('Langue')).toBeTruthy();
    expect(screen.getByText('Mes données')).toBeTruthy();
    expect(screen.getByText('Télécharger mes données')).toBeTruthy();
    expect(screen.getByText('Supprimer mon compte')).toBeTruthy();
    expect(screen.getByText('Politique de confidentialité')).toBeTruthy();
    expect(screen.getByText('Une idée ? Un problème ?')).toBeTruthy();
    expect(screen.getByText('Se déconnecter')).toBeTruthy();
  });

  it('hides everything that only exists in the app', async () => {
    await render(<Profile />);
    for (const text of [
      'Changer la photo',
      "Mes centres d'intérêt",
      'Ma zone',
      'Supprimer mes messages des activités quittées',
    ]) {
      expect(screen.queryByText(text)).toBeNull();
    }
    expect(mockNative).not.toHaveBeenCalled();
  });

  it('exports the data', async () => {
    (exportMyData as jest.Mock).mockResolvedValue({ ok: true, path: 'x' });
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Télécharger mes données'));
    await waitFor(() => expect(exportMyData).toHaveBeenCalledTimes(1));
  });

  it('deleting the account asks through the browser confirm (Alert does nothing on the web)', async () => {
    (deleteMyAccount as jest.Mock).mockResolvedValue({ ok: true });
    const confirm = setConfirm(true);
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Supprimer mon compte'));
    expect(confirm).toHaveBeenCalledWith('Supprimer définitivement votre compte et toutes vos données ?');
    await waitFor(() => expect(deleteMyAccount).toHaveBeenCalledTimes(1));
  });

  it('a refused confirm deletes nothing', async () => {
    setConfirm(false);
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Supprimer mon compte'));
    expect(deleteMyAccount).not.toHaveBeenCalled();
  });

  it('signs out', async () => {
    await render(<Profile />);
    await fireEvent.press(screen.getByText('Se déconnecter'));
    expect(signOut).toHaveBeenCalled();
  });
});
