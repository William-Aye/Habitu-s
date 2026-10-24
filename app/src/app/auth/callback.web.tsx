import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { takeReturnPath } from '../../features/account/oauthReturn';
import { supabase } from '../../lib/supabase';

/**
 * Where Google sends the visitor back (Supabase redirect URL). The one-time code in the address is
 * exchanged for a session, then the visitor returns to the page they came from.
 */
export default function AuthCallback() {
  const { t } = useTranslation();
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URLSearchParams(window.location.search).get('code');
    const finish = async () => {
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
        } catch {
          // Same destination: the visitor can try again from the page.
        }
      }
      // Failure or not, the visitor goes back to the page they came from (the page offers the sign-up again),
      // and the remembered path is always consumed.
      const back = takeReturnPath();
      router.replace(back as Href);
    };
    void finish();
  }, [router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator accessibilityLabel={t('web.signingIn')} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
