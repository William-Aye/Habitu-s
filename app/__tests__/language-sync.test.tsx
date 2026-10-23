import { render, waitFor } from '@testing-library/react-native';
import i18next from 'i18next';
import { LanguageSync } from '../src/features/account/LanguageSync';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));

const mockSession: { status: string; userId: string | null; profile: { language: 'fr' | 'en' } | null } = {
  status: 'signed_out',
  userId: null,
  profile: null,
};
jest.mock('../src/features/account/useSession', () => ({
  useSession: () => ({ ...mockSession, error: false, refresh: jest.fn() }),
}));

beforeAll(async () => {
  await initI18n();
});
beforeEach(async () => {
  await i18next.changeLanguage('fr');
  mockSession.status = 'signed_out';
  mockSession.userId = null;
  mockSession.profile = null;
});

it('applies the profile language on sign-in when it differs from the current one', async () => {
  const { rerender } = await render(<LanguageSync />);
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
  mockSession.profile = { language: 'en' };
  await rerender(<LanguageSync />);
  await waitFor(() => expect(i18next.language).toBe('en'));
});

it('does nothing when the language already matches', async () => {
  const spy = jest.spyOn(i18next, 'changeLanguage');
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
  mockSession.profile = { language: 'fr' };
  await render(<LanguageSync />);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it('applies it once per sign-in: a later local language change is not reverted', async () => {
  mockSession.status = 'ready';
  mockSession.userId = 'u1';
  mockSession.profile = { language: 'en' };
  const { rerender } = await render(<LanguageSync />);
  await waitFor(() => expect(i18next.language).toBe('en'));
  await i18next.changeLanguage('fr');
  await rerender(<LanguageSync />);
  expect(i18next.language).toBe('fr');
});
