const makeConfig = require('../app.config.js');

const fs = require('node:fs');
const path = require('node:path');
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf8'));
const base = { android: { package: 'fr.habitues.app' } };

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

describe('app.config.js production profile', () => {
  const OLD = { p: process.env.EAS_BUILD_PROFILE, u: process.env.EXPO_PUBLIC_WEB_BASE_URL };
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  afterEach(() => {
    restore('EAS_BUILD_PROFILE', OLD.p);
    restore('EXPO_PUBLIC_WEB_BASE_URL', OLD.u);
  });
  it('fails the production build when the website address is missing', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    delete process.env.EXPO_PUBLIC_WEB_BASE_URL;
    expect(() => makeConfig({ config: base })).toThrow(/EXPO_PUBLIC_WEB_BASE_URL/);
  });
  it('accepts the production build with the address, and other profiles without it', () => {
    process.env.EAS_BUILD_PROFILE = 'production';
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habitues.example';
    expect(() => makeConfig({ config: base })).not.toThrow();
    process.env.EAS_BUILD_PROFILE = 'preview';
    delete process.env.EXPO_PUBLIC_WEB_BASE_URL;
    expect(() => makeConfig({ config: base })).not.toThrow();
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

describe('final identity and release profile', () => {
  const OLD = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = OLD;
  });
  it('has the Habitués name, package, scheme and first version code', () => {
    const cfg = makeConfig({ config: appJson.expo });
    expect(cfg.name).toBe('Habitués');
    expect(cfg.android.package).toBe('fr.habitues.app');
    expect(cfg.scheme).toBe('habitues');
    expect(cfg.version).toBe('1.0.0');
    expect(cfg.android.versionCode).toBe(1);
  });
  it('blocks the permissions the app never uses', () => {
    const blocked = makeConfig({ config: appJson.expo }).android.blockedPermissions;
    expect(blocked).toEqual(
      expect.arrayContaining([
        'android.permission.RECORD_AUDIO',
        'com.google.android.gms.permission.AD_ID',
        'android.permission.CAMERA',
        'android.permission.READ_CALENDAR',
        'android.permission.WRITE_CALENDAR',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.ACCESS_FINE_LOCATION',
      ]),
    );
    expect(blocked).not.toContain('android.permission.ACCESS_COARSE_LOCATION');
    expect(blocked).not.toContain('android.permission.POST_NOTIFICATIONS');
  });
  it('keeps App Links with the final package when the web address is set', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habitues.example/';
    const cfg = makeConfig({ config: appJson.expo });
    expect(cfg.android.intentFilters).toHaveLength(1);
    expect(cfg.android.blockedPermissions).toContain('android.permission.RECORD_AUDIO');
  });
  it('has EAS profiles for a store bundle and an internal APK', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, '../eas.json'), 'utf8'));
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production).toMatchObject({ autoIncrement: true, distribution: 'store', android: { buildType: 'app-bundle' } });
    expect(eas.build.preview).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' } });
  });
});
