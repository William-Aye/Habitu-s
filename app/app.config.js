// Expo merges this over app.json. It only changes where the Android Firebase file comes from:
// EAS builds supply it as a file secret (the GOOGLE_SERVICES_JSON variable holds its path); local
// builds use app/google-services.json, which is not committed (see README, "Activities and notifications").
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
