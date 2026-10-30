const makeConfig = require('../app.config.js');

const base = { android: { package: 'fr.friendapp.app' } };

describe('app.config.js Android App Links', () => {
  const OLD = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = OLD;
  });
  it('adds verified intent filters for the web host', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habitues.example/';
    const cfg = makeConfig({ config: base });
    expect(cfg.android.intentFilters).toEqual([
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          { scheme: 'https', host: 'habitues.example', pathPrefix: '/activites/' },
          { scheme: 'https', host: 'habitues.example', pathPrefix: '/associations/' },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ]);
  });
  it('adds none when the variable is empty', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = '';
    expect(makeConfig({ config: base }).android.intentFilters).toBeUndefined();
  });
});

describe('web shell (Expo public/index.html template)', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/index.html'), 'utf8');
  it('is French and titled Habitués', () => {
    expect(html).toMatch(/<html lang="fr">/);
    expect(html).toMatch(/<title>Habitués<\/title>/);
    expect(html).toContain('<div id="root"></div>');
  });
});

describe('Android backup (APP-6)', () => {
  it('turns allowBackup off so local interests and location stay out of cloud backups', () => {
    const appJson = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../app.json'), 'utf8'));
    expect(appJson.expo.android.allowBackup).toBe(false);
    expect(makeConfig({ config: appJson.expo }).android.allowBackup).toBe(false);
  });
});
