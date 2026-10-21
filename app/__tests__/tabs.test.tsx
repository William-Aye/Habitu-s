import { renderRouter, screen } from 'expo-router/testing-library';
import { initI18n } from '../src/i18n';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-GB' }],
}));

// First run compiles expo-router from a cold transform cache, which is slow.
jest.setTimeout(60000);

beforeAll(async () => {
  await initI18n();
});

it('shows the four tabs with French labels by default', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  for (const label of ['Explorer', 'Mes activités', 'Messages', 'Profil']) {
    expect(await screen.findByText(label)).toBeTruthy();
  }
});

it('shows the search bar at the top of Explorer', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  const placeholder = 'Rechercher une activité, un club, une association…';
  expect(await screen.findByPlaceholderText(placeholder)).toBeTruthy();
  const field = await screen.findByLabelText(placeholder);
  expect(field.props.editable).toBe(false);
});
