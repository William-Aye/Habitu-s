import { render, screen } from '@testing-library/react-native';
import Privacy, { splitPrivacy } from '../src/app/privacy';
import { privacyEn } from '../src/content/privacy.en';
import { privacyFr } from '../src/content/privacy.fr';
import { initI18n } from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));

beforeAll(async () => {
  await initI18n();
});

it('splits blocks on blank lines and turns # lines into headings', () => {
  expect(splitPrivacy('# Titre\n\nUn paragraphe\n\n\n- a\n- b')).toEqual([
    { kind: 'heading', text: 'Titre' },
    { kind: 'text', text: 'Un paragraphe' },
    { kind: 'text', text: '- a\n- b' },
  ]);
});

it('starts with the review line, in both languages', () => {
  expect(privacyFr.startsWith('Version à faire relire par une personne qualifiée avant la publication.')).toBe(true);
  expect(privacyEn.length).toBeGreaterThan(0);
});

it('states the cascade and the placeholder contact in both languages', () => {
  for (const text of [privacyFr, privacyEn]) {
    expect(text).toContain('confidentialite@<domaine>');
    expect(text).toContain('CNIL');
  }
  expect(privacyFr).toContain('supprime aussi les activités que vous organisez');
  expect(privacyFr).toContain('ne sont plus rattachés à vous');
  expect(privacyEn).toContain('also deletes the activities you organise');
  expect(privacyEn).toContain('no longer linked to you');
});

it('renders the French policy', async () => {
  await render(<Privacy />);
  expect(screen.getByText('Politique de confidentialité')).toBeTruthy();
  expect(screen.getByText('Ce que nous collectons')).toBeTruthy();
});
