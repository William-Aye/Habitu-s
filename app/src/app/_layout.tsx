import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initI18n } from '../i18n';
import { AccountGateProvider } from '../features/account/AccountGate';
import { SessionProvider, useSession } from '../features/account/useSession';
import { mergeLocalIntoAccount } from '../features/interests/store';

// A failed merge keeps the local interests for the next sign-in; the log carries no user data.
async function mergeInterests(userId: string): Promise<void> {
  try {
    await mergeLocalIntoAccount(userId);
  } catch {
    console.warn('interests merge failed');
  }
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff' },
});

const ONBOARDING_KEY = 'onboarding.done';

/**
 * Sends a signed-out first-time user to /onboarding. Nothing is rendered until the flag is read
 * and the session has settled, so neither screen flashes for the wrong person.
 */
function OnboardingGate() {
  const { status } = useSession();
  const router = useRouter();
  const [done, setDone] = useState<boolean | null>(null);
  const redirected = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((v) => active && setDone(v === '1'))
      .catch(() => active && setDone(true)); // unreadable storage must not trap the user
    return () => {
      active = false;
    };
  }, []);

  const settled = done !== null && status !== 'loading';
  const needsOnboarding = settled && !done && status === 'signed_out';

  useEffect(() => {
    if (needsOnboarding && !redirected.current) {
      redirected.current = true;
      router.replace('/onboarding');
    }
  }, [needsOnboarding, router]);

  // The navigator must stay mounted for the redirect to work; a blank cover hides it until settled.
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {settled ? null : <View pointerEvents="auto" style={styles.cover} />}
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    initI18n()
      .catch((error: unknown) => {
        console.warn('i18n initialisation failed', error);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!ready) return null;

  return (
    <I18nextProvider i18n={i18next}>
      <SessionProvider>
        <AccountGateProvider onSignedUp={mergeInterests}>
          <OnboardingGate />
        </AccountGateProvider>
      </SessionProvider>
    </I18nextProvider>
  );
}
