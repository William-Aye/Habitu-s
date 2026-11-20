import config from '../app.json';

// The screens are designed light only (warm off-white, dark text). With "automatic", Android dark mode
// turns system parts dark (keyboard, dialogs) and unstyled text fields can show light text on white.
// Switch back to "automatic" only together with a dark palette in lib/theme.
it('the app declares a light interface until it has a dark design', () => {
  expect(config.expo.userInterfaceStyle).toBe('light');
});

it('icons and splash use the warm palette', () => {
  expect(config.expo.android.adaptiveIcon.backgroundColor).toBe('#FDE8DC');
  const splash = config.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen') as [string, { backgroundColor: string }];
  expect(splash[1].backgroundColor).toBe('#FDE8DC');
});
