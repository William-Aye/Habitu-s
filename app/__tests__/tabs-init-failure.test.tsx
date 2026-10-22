import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, screen } from 'expo-router/testing-library';

jest.mock('../src/i18n', () => {
  const actual = jest.requireActual('../src/i18n');
  return { ...actual, initI18n: jest.fn(() => Promise.reject(new Error('boom'))) };
});

jest.setTimeout(60000);

let warn: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.setItem('onboarding.done', '1');
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

it('still renders the tabs when i18n initialisation fails', async () => {
  // Initialise the real i18n directly (the mocked initI18n rejects) so French labels still resolve.
  const { initI18n: realInit } = jest.requireActual('../src/i18n');
  await realInit();
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(warn).toHaveBeenCalledWith('i18n initialisation failed', expect.any(Error));
});
