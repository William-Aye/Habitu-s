import { render, screen } from '@testing-library/react-native';
import Privacy, { splitPrivacy } from '../src/app/privacy';
import { privacyEn } from '../src/content/privacy.en';
import { privacyFr } from '../src/content/privacy.fr';
import { initI18n } from '../src/i18n';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'fr-FR' }] }));

// The first case is slow on a cold start (module loading).
jest.setTimeout(15000);

beforeAll(async () => {
  await initI18n();
});

it('splits blocks on blank lines and turns # lines into headings', () => {
  expect(splitPrivacy('# Titre\n\nUn paragraphe\n\n\n- a\n- b')).toEqual([
    { kind: 'heading', text: 'Titre' },
    { kind: 'text', text: 'Un paragraphe' },
    { kind: 'text', text: '- a\n- b' },
  ]);
}, 15000);

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

it('marks every not-yet-built feature in both languages', () => {
  const body = (s: string) => s.split('\n').filter((l) => !l.startsWith('//')).join('\n');
  expect(body(privacyFr).split('(dès que cette fonctionnalité sera disponible)')).toHaveLength(9);
  expect(body(privacyEn).split('(once this feature is available)')).toHaveLength(9);
});

it('names the push processors, the lock screen exposure and the 30-day retention of notifications', () => {
  for (const [text, words] of [
    [privacyFr, ['Expo', 'Firebase Cloud Messaging', 'Apple Push Notification service', "ne contiennent aucun nom d'activité ni prénom", '30 jours sur nos serveurs']],
    [privacyEn, ['Expo', 'Firebase Cloud Messaging', 'Apple Push Notification service', 'contain no activity name or first name', '30 days on our servers']],
  ] as const) {
    for (const w of words) expect(text).toContain(w);
  }
  expect(privacyFr).not.toContain('écran verrouillé');
  expect(privacyEn).not.toContain('lock screen');
  expect(privacyFr).not.toContain("Expo (envoi des notifications) (dès que");
});

it('describes the GPS position as rounded, used to search and find the commune, never stored', () => {
  expect(privacyFr).toContain('arrondie à environ 1 km');
  expect(privacyFr).toContain('trouver votre commune');
  expect(privacyFr).toContain('jamais enregistrée');
  expect(privacyEn).toContain('rounded to about 1 km');
  expect(privacyEn).toContain('find your town');
  expect(privacyEn).toContain('never stored');
});

it('lists geo.api.gouv.fr among the processors in both languages', () => {
  for (const text of [privacyFr, privacyEn]) {
    expect(text).toContain('geo.api.gouv.fr');
    expect(text).toContain('data.gouv');
  }
});

it('explains that received private messages are not part of the export (art. 15(4) GDPR)', () => {
  expect(privacyFr).toContain('messages privés que vous avez reçus');
  expect(privacyFr).toContain('art. 15, § 4');
  expect(privacyEn).toContain('private messages you received');
  expect(privacyEn).toContain('Art. 15(4)');
});

it('names the suggestion form instead of the ambiguous reviews, and mentions the town correction', () => {
  expect(privacyFr).toContain('vos suggestions « Une idée ? Un problème ? » restent');
  expect(privacyFr).not.toContain('les avis que vous avez envoyés');
  expect(privacyFr).toContain('votre ville');
  expect(privacyEn).toContain('your "Une idée ? Un problème ?" suggestions stay');
  expect(privacyEn).toContain('your town');
  expect(privacyFr).toContain('adresse e-mail');
  expect(privacyEn).toContain('sign-in methods');
});
