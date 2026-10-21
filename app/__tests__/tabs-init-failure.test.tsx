import { renderRouter, screen } from 'expo-router/testing-library';

jest.mock('../src/i18n', () => {
  const actual = jest.requireActual('../src/i18n');
  return { ...actual, initI18n: jest.fn(() => Promise.reject(new Error('boom'))) };
});

jest.setTimeout(60000);

it('still renders the tabs when i18n initialisation fails', async () => {
  const { initI18n: realInit } = jest.requireActual('../src/i18n');
  await realInit();
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Explorer')).toBeTruthy();
  expect(warn).toHaveBeenCalledWith('i18n initialisation failed', expect.any(Error));
  warn.mockRestore();
});
