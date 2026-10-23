import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { Stack, usePathname, useRouter } from 'expo-router';
import { AppState, StyleSheet, useColorScheme, View } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { initI18n } from '../i18n';
import { AccountGateProvider } from '../features/account/AccountGate';
import { SessionProvider, useSession } from '../features/account/useSession';
import { cleanupExportFiles } from '../features/account/myData';
import { touchLastSeen } from '../features/account/lastSeen';
import { InterestsMerger, mergeInterests } from '../features/interests/InterestsMerger';
import { LanguageSync } from '../features/account/LanguageSync';
import { initOutbox } from '../features/chat/outbox';
import { NotificationResponder } from '../features/notifications/NotificationResponder';

/** Tells the server the signed-in user is active, at launch and whenever the app returns to the foreground. */
function LastSeenToucher() {
  const { status, userId } = useSession();
  useEffect(() => {
    if (status !== 'ready') return;
    void touchLastSeen(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void touchLastSeen(userId);
    });
    return () => sub.remove();
  }, [status, userId]);
  return null;
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});

/** How long the cover waits for the session before showing the app anyway. */
const SESSION_WAIT_MS = 3000;

const ONBOARDING_KEY = 'onboarding.done';

/**
 * Sends a signed-out first-time user to /onboarding. Nothing is rendered until the flag is read
 * and the session has settled, so neither screen flashes for the wrong person.
 */
function OnboardingGate() {
  const { status, error } = useSession();
  const router = useRouter();
  const scheme = useColorScheme();
  const pathname = usePathname();
  const [startedOnHome] = useState(() => pathname === '/');
  const [waited, setWaited] = useState(false);
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

  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), SESSION_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  // A returning user (ever signed in) never sees the first-launch screen again.
  useEffect(() => {
    if (status === 'ready') {
      AsyncStorage.setItem(ONBOARDING_KEY, '1').catch(() => {
        console.warn('onboarding flag write failed');
      });
    }
  }, [status]);

  // A failing or slow session fetch must not hold the app behind the cover forever.
  // Remembered for the rest of the run: once ready, a later sign-out must not trigger onboarding.
  if (status === 'ready' && done !== true) setDone(true);
  // If the flag read never resolves, the fallback wait treats the user as done.
  const known = done ?? (waited ? true : null);
  const settled = known !== null && (status !== 'loading' || error || waited);
  const needsOnboarding = settled && !known && status === 'signed_out' && startedOnHome;

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
      {settled ? null : <View
          testID="startup-cover"
          pointerEvents="auto"
          style={[styles.cover, { backgroundColor: scheme === 'dark' ? '#121212' : '#fff' }]}
        />}
    </>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    cleanupExportFiles();
    initOutbox();
  }, []);

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
          <LastSeenToucher />
          <InterestsMerger />
          <LanguageSync />
          <NotificationResponder />
          <OnboardingGate />
        </AccountGateProvider>
      </SessionProvider>
    </I18nextProvider>
  );
}
