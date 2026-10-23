import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { getLocales } from 'expo-localization';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LocationPicker } from '../features/explore/components/LocationPicker';
import { useExploreLocation } from '../features/explore/useExploreLocation';
import { InterestPicker } from '../features/interests/InterestPicker';
import { LANGUAGE_STORAGE_KEY, setLanguage, shouldOfferLanguageChoice } from '../i18n';

export const ONBOARDING_KEY = 'onboarding.done';

export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { location, requestGps, setTown } = useExploreLocation();
  const [offerLanguage, setOfferLanguage] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      let stored: string | null = null;
      let device: string | null = null;
      try {
        stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      } catch {
        // unreadable storage: behave as if nothing is stored
      }
      try {
        device = getLocales()[0]?.languageTag ?? null;
      } catch {
        // unknown device language: no choice offered
      }
      if (active) setOfferLanguage(shouldOfferLanguageChoice(stored, device));
    })();
    return () => {
      active = false;
    };
  }, []);

  const finish = async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // worst case the screen shows again next launch
    }
    router.replace('/');
  };

  const current = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const ready = location !== null;

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      {offerLanguage ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('onboarding.languageTitle')}
          </Text>
          <View style={styles.row}>
            {(['fr', 'en'] as const).map((lng) => (
              <Pressable
                key={lng}
                accessibilityRole="button"
                accessibilityLabel={t(lng === 'fr' ? 'onboarding.french' : 'onboarding.english')}
                accessibilityState={{ selected: current === lng }}
                style={[styles.choice, current === lng && styles.choiceOn]}
                onPress={() => void setLanguage(lng)}
              >
                <Text style={current === lng ? styles.choiceOnText : styles.choiceText}>
                  {t(lng === 'fr' ? 'onboarding.french' : 'onboarding.english')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('onboarding.where')}
        </Text>
        <LocationPicker onGps={() => requestGps({ toCommune: true })} onTown={(town) => void setTown(town)} />
        {location ? (
          <Text accessibilityLiveRegion="polite" style={styles.chosen}>
            {t('onboarding.chosen', { place: location.label })}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('onboarding.like')}
        </Text>
        <InterestPicker compact />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onboarding.start')}
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        style={[styles.primary, !ready && styles.disabled]}
        onPress={() => void finish()}
      >
        <Text style={styles.primaryText}>{t('onboarding.start')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('onboarding.skip')}
        style={styles.skip}
        onPress={() => void finish()}
      >
        <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, gap: 24 },
  section: { gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12 },
  choice: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceOn: { backgroundColor: '#1a56db' },
  choiceText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  choiceOnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  chosen: { fontSize: 14, color: '#333' },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  skip: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
});
