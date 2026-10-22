import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { InterestPicker } from '../src/features/interests/InterestPicker';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));

const mockSession: { value: null | { user: { id: string } } } = { value: null };
const mockInsert = jest.fn(async (_row: unknown) => ({ error: null }));
jest.mock('../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockSession.value } }),
    },
    from: (table: string) => {
      if (table === 'category_requests') return { insert: mockInsert };
      throw new Error('unexpected table ' + table);
    },
  },
}));

jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({
    status: mockSession.value ? 'ready' : 'signed_out',
    userId: mockSession.value ? mockSession.value.user.id : null,
    profile: null,
    error: false,
    refresh: jest.fn(),
  }),
}));

const mockGate = jest.fn();
jest.mock('../src/features/account/AccountGate', () => ({
  useRequireAccount: () => mockGate,
}));

jest.mock('../src/features/interests/categories', () => {
  const actual = jest.requireActual('../src/features/interests/categories');
  return {
    ...actual,
    fetchCategories: async () => [
      { id: 'g', slug: 'games', nameFr: 'Jeux', nameEn: 'Games', icon: 'dice-5', parentId: null },
      { id: 'm', slug: 'music', nameFr: 'Musique', nameEn: 'Music', icon: 'music', parentId: null },
      { id: 'e', slug: 'chess', nameFr: 'Échecs', nameEn: 'Chess', icon: 'dice-5', parentId: 'g' },
    ],
  };
});

beforeAll(async () => {
  await initI18n();
});
beforeEach(async () => {
  mockInsert.mockClear();
  mockGate.mockReset();
  mockSession.value = null;
  await AsyncStorage.clear();
});

async function show() {
  await render(
    <I18nextProvider i18n={i18next}>
      <InterestPicker />
    </I18nextProvider>,
  );
  await screen.findByText('Musique');
}

it('tap cycles like, love, none; long-press shows curious', async () => {
  await show();
  const tile = () => screen.getByLabelText('Musique');
  await fireEvent.press(tile());
  expect(await screen.findByText("J'aime")).toBeTruthy();
  await fireEvent.press(tile());
  expect(await screen.findByText("J'adore")).toBeTruthy();
  await fireEvent.press(tile());
  await waitFor(() => expect(screen.queryByText("J'adore")).toBeNull());
  expect(screen.queryByText("J'aime")).toBeNull();
  await fireEvent(tile(), 'longPress');
  expect(await screen.findByText('Curieux')).toBeTruthy();
});

it('filters accent-insensitively and keeps the parent of a matching child', async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText('Filtrer les catégories'), 'echecs');
  expect(await screen.findByText('Échecs')).toBeTruthy();
  expect(screen.getByText('Jeux')).toBeTruthy();
  expect(screen.queryByText('Musique')).toBeNull();
});

it('asks for an account before the request form and sends nothing until signed in', async () => {
  let resolveGate!: (ok: boolean) => void;
  mockGate.mockReturnValue(new Promise<boolean>((r) => (resolveGate = r)));
  await show();
  await fireEvent.press(screen.getByText('Vous ne trouvez pas ? Proposer une catégorie'));
  expect(mockGate).toHaveBeenCalledWith('category');
  expect(screen.queryByLabelText('Nom de la catégorie')).toBeNull();
  expect(mockInsert).not.toHaveBeenCalled();

  mockSession.value = { user: { id: 'u1' } };
  await act(async () => {
    resolveGate(true);
  });
  await fireEvent.changeText(await screen.findByLabelText('Nom de la catégorie'), 'Pétanque');
  await fireEvent.press(screen.getByRole('button', { name: 'Envoyer' }));
  await waitFor(() =>
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'u1',
      requested_name: 'Pétanque',
      status: 'pending',
    }),
  );
});

it('shows the invalid message for a 1-character request', async () => {
  mockGate.mockResolvedValue(true);
  mockSession.value = { user: { id: 'u1' } };
  await show();
  await fireEvent.press(screen.getByText('Vous ne trouvez pas ? Proposer une catégorie'));
  await fireEvent.changeText(await screen.findByLabelText('Nom de la catégorie'), 'a');
  await fireEvent.press(screen.getByRole('button', { name: 'Envoyer' }));
  expect(await screen.findByText('Le nom doit faire entre 2 et 80 caractères.')).toBeTruthy();
  expect(mockInsert).not.toHaveBeenCalled();
});

it('lets the user send another category after one was sent', async () => {
  mockGate.mockResolvedValue(true);
  mockSession.value = { user: { id: 'u1' } };
  await show();
  await fireEvent.press(screen.getByText('Vous ne trouvez pas ? Proposer une catégorie'));
  await fireEvent.changeText(await screen.findByLabelText('Nom de la catégorie'), 'Pétanque');
  await fireEvent.press(screen.getByRole('button', { name: 'Envoyer' }));
  await fireEvent.press(await screen.findByText('Proposer une autre catégorie'));
  await fireEvent.changeText(await screen.findByLabelText('Nom de la catégorie'), 'Bridge');
  await fireEvent.press(screen.getByRole('button', { name: 'Envoyer' }));
  await waitFor(() => expect(mockInsert).toHaveBeenCalledTimes(2));
});

it('exposes a Curieux accessibility action as the screen-reader path for long-press', async () => {
  await show();
  const tile = screen.getByLabelText('Musique');
  expect(tile.props.accessibilityActions).toEqual([{ name: 'curious', label: 'Curieux' }]);
  await fireEvent(tile, 'accessibilityAction', { nativeEvent: { actionName: 'curious' } });
  expect(await screen.findByText('Curieux')).toBeTruthy();
});
