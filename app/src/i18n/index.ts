import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
/* eslint-disable import/no-named-as-default-member -- default instance is the intended API */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import fr from './locales/fr.json';

export type AppLanguage = 'fr' | 'en';

export const LANGUAGE_STORAGE_KEY = 'app.language';

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === 'fr' || value === 'en';
}

export function resolveInitialLanguage(
  stored: string | null,
  // Device language is deliberately ignored: French is the default everywhere.
  _deviceLanguageTag: string | null,
): AppLanguage {
  return isAppLanguage(stored) ? stored : 'fr';
}

export function shouldOfferLanguageChoice(
  stored: string | null,
  deviceLanguageTag: string | null,
): boolean {
  if (isAppLanguage(stored)) return false;
  const primary = (deviceLanguageTag ?? '').split(/[-_]/)[0].toLowerCase();
  return primary === 'en';
}

export async function initI18n(): Promise<AppLanguage> {
  const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
  const deviceTag = getLocales()[0]?.languageTag ?? null;
  const lng = resolveInitialLanguage(stored, deviceTag);
  await i18next.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return lng;
}

export async function setLanguage(lang: AppLanguage): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  await i18next.changeLanguage(lang);
}
