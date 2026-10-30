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

it('leaves out every feature that is not in Release 1, in both languages', () => {
  const body = (s: string) => s.split('\n').filter((l) => !l.startsWith('//')).join('\n');
  expect(body(privacyFr)).not.toContain('(dès que cette fonctionnalité sera disponible)');
  expect(body(privacyEn)).not.toContain('(once this feature is available)');
  expect(body(privacyFr)).not.toMatch(/numéro de téléphone|Messages privés :|Réponses aux avis après séance/);
  expect(body(privacyEn)).not.toMatch(/phone number|Private messages:|Feedback answers after sessions/);
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

it('does not mention received private messages in the export paragraph (not in Release 1)', () => {
  expect(privacyFr).not.toContain('messages privés que vous avez reçus');
  expect(privacyEn).not.toContain('private messages you received');
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

it('says a copy of a reported message is kept with the report, in both languages', () => {
  expect(privacyFr).toContain('Lorsqu\'un message est signalé, une copie est conservée avec le signalement');
  expect(privacyEn).toContain('When a message is reported, a copy is kept with the report');
});

it('no longer marks the shipped retention rules as pending', () => {
  for (const [text, marker] of [
    [privacyFr, '(dès que cette fonctionnalité sera disponible)'],
    [privacyEn, '(once this feature is available)'],
  ] as const) {
    for (const line of text.split(String.fromCharCode(10))) {
      if (/^- (Messages de groupe|Group messages|Signalements|Reports|Comptes inactifs|Accounts inactive)/.test(line)) {
        expect(line).not.toContain(marker);
      }
    }
  }
});

it('describes the moderation, feedback, claims, Overpass and inactivity data in both languages', () => {
  for (const [text, words] of [
    [
      privacyFr,
      ['Turnstile', 'Overpass', 'coordonnées arrondies', 'motif de la décision', 'justificatif', '2 ans', "Journal d'administration",
       '30 jours avant', 'notification', "version de l'application", "tant que l'association reste vérifiée", '1 an'],
    ],
    [
      privacyEn,
      ['Turnstile', 'Overpass', 'rounded coordinates', 'statement of reasons', 'supporting document', '2 years', 'Admin audit log',
       '30 days before', 'notification', 'app version', 'while the association stays verified', '1 year'],
    ],
  ] as const) {
    for (const w of words) expect(text).toContain(w);
  }
  expect(privacyFr).toContain("voit l'adresse réseau de votre téléphone");
  expect(privacyFr).toContain("aucune donnée de votre compte n'est envoyée");
  expect(privacyEn).toContain("sees your phone's network address");
  expect(privacyEn).toContain('no account data is sent');
  expect(privacyFr).not.toContain("e-mail d'avertissement");
  expect(privacyEn).not.toContain('warning email');
});

it('has a "Site web" section in both languages (hosting, session, Turnstile, public pages)', () => {
  const section = (text: string, title: string) => {
    const i = text.indexOf(`# ${title}`);
    expect(i).toBeGreaterThan(-1);
    const rest = text.slice(i + title.length + 2);
    const j = rest.indexOf('\n# ');
    return j === -1 ? rest : rest.slice(0, j);
  };
  const fr = section(privacyFr, 'Site web');
  for (const w of ['Cloudflare Pages', 'journaux techniques', 'stockage de votre navigateur', 'strictement nécessaire', 'aucune bannière', 'Cloudflare Turnstile', 'page d\'inscription', 'pages publiques', 'prochaine séance']) {
    expect(fr).toContain(w);
  }
  const en = section(privacyEn, 'Website');
  for (const w of ['Cloudflare Pages', 'technical logs', 'browser storage', 'strictly necessary', 'no consent banner', 'Cloudflare Turnstile', 'sign-up page', 'public pages', 'next session']) {
    expect(en).toContain(w);
  }
});

it('the rights section works on the website too', () => {
  expect(privacyFr).not.toContain("Dans l'application, ouvrez Profil");
  expect(privacyEn).not.toContain('In the app, open Profile');
  expect(privacyFr).toContain('« Mon compte »');
  expect(privacyEn).toContain('"My account"');
});

it('public activity pages: organising association or collectif, never members', () => {
  expect(privacyFr).toContain("l'association ou le collectif organisateur");
  expect(privacyFr).toContain("Les noms et les photos des membres n'y figurent jamais");
  expect(privacyFr).toContain("prénom de l'organisateur n'est visible que par les personnes connectées");
  expect(privacyEn).toContain('organising association or collective');
  expect(privacyEn).toContain("Members' names and photos never appear on them");
  expect(privacyEn).toContain("organiser's first name is only visible to signed-in people");
  expect(privacyFr).not.toContain('PENDING');
  expect(privacyEn).not.toContain('PENDING');
});
