// Expo merges this over app.json. It only decides where the Android Firebase file comes from:
// EAS builds supply it as a file secret (the GOOGLE_SERVICES_JSON variable holds its path); local
// builds use app/google-services.json, which is not committed (see README, "Activities and notifications").
// Without either, the setting is left out so a local build without the file still works (no push).
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  const local = path.join(__dirname, 'google-services.json');
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? './google-services.json' : null);
  return file ? { ...config, android: { ...config.android, googleServicesFile: file } } : config;
};
