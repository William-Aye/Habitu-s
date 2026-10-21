import AsyncStorage from '@react-native-async-storage/async-storage';
import i18next from 'i18next';

import {
  initI18n,
  LANGUAGE_STORAGE_KEY,
  resolveInitialLanguage,
  setLanguage,
  shouldOfferLanguageChoice,
} from '../src/i18n';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-GB' }],
}));


describe('resolveInitialLanguage', () => {
  it.each([
    [null, 'en-GB', 'fr'], [null, 'en_US', 'fr'], [null, 'EN', 'fr'], [null, 'de-DE', 'fr'],
    [null, 'fr-CA', 'fr'], [null, '', 'fr'], [null, null, 'fr'],
    ['en', 'fr-FR', 'en'], ['fr', 'en-GB', 'fr'], ['xx', 'en-GB', 'fr'],
  ])('stored=%p device=%p -> %p', (stored, device, expected) => {
    expect(resolveInitialLanguage(stored, device)).toBe(expected);
  });
});

describe('shouldOfferLanguageChoice', () => {
  it.each([
    [null, 'en-GB', true], ['xx', 'en-GB', true], [null, 'en_US', true], [null, 'EN', true],
    [null, 'fr-FR', false], [null, 'de-DE', false], [null, null, false], [null, '', false],
    ['fr', 'en-GB', false], ['en', 'en-GB', false],
  ])('stored=%p device=%p -> %p', (stored, device, expected) => {
    expect(shouldOfferLanguageChoice(stored, device)).toBe(expected);
  });
});

describe('initI18n / setLanguage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('resolves fr when storage rejects', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    await expect(initI18n()).resolves.toBe('fr');
  });

  it('returns en when en is stored (and is idempotent)', async () => {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await expect(initI18n()).resolves.toBe('en');
    await expect(initI18n()).resolves.toBe('en');
    expect(i18next.language).toBe('en');
  });

  it('setLanguage persists and changes language', async () => {
    await setLanguage('fr');
    await setLanguage('en');
    expect(await AsyncStorage.getItem('app.language')).toBe('en');
    expect(i18next.language).toBe('en');
  });

  it('setLanguage keeps the UI change when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('boom'));
    await expect(setLanguage('fr')).resolves.toBeUndefined();
    expect(i18next.language).toBe('fr');
  });
});
