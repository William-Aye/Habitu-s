// Expo merges this over app.json. It decides two things:
// - where the Android Firebase file comes from: EAS builds supply it as a file secret (the
//   GOOGLE_SERVICES_JSON variable holds its path); local builds use app/google-services.json, which is
//   not committed (see README, "Activities and notifications"). Without either, the setting is left out
//   so a local build without the file still works (no push).
// - Android App Links: when EXPO_PUBLIC_WEB_BASE_URL is set, the app claims the website's
//   /activites/* and /associations/* addresses (verified through /.well-known/assetlinks.json).
const fs = require('fs');
const path = require('path');

function appLinks() {
  const raw = (process.env.EXPO_PUBLIC_WEB_BASE_URL || '').trim();
  if (!raw) return null;
  let host;
  try {
    host = new URL(raw).host;
  } catch {
    return null;
  }
  return [
    {
      action: 'VIEW',
      autoVerify: true,
      data: [
        { scheme: 'https', host, pathPrefix: '/activites/' },
        { scheme: 'https', host, pathPrefix: '/associations/' },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];
}

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : null);
  const links = appLinks();
  const android = { ...config.android };
  if (file) android.googleServicesFile = file;
  if (links) android.intentFilters = [...(config.android?.intentFilters ?? []), ...links];
  return file || links ? { ...config, android } : config;
};
