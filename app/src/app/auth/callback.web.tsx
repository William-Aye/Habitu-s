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
      let ok = false;
      if (code) {
        try {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          ok = !error;
        } catch {
          ok = false;
        }
      }
      // Failure or not, the visitor is sent back: the page offers the sign-up again.
      router.replace((ok ? takeReturnPath() : '/') as Href);
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
