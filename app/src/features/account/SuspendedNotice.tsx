import { ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRIVACY_CONTACT } from '../../content/contact';
import { signOut } from './auth';
import { useSession } from './useSession';

/**
 * Full-screen notice for a suspended account: it cannot sign in, so this is where the person learns why
 * and how to contest the decision. Dismissing it signs out whatever is left of the session.
 */
export function SuspendedNotice() {
  const { t } = useTranslation();
  const { banned } = useSession();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!banned || dismissed) return null;

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    await signOut();
    setBusy(false);
    setDismissed(true);
  };

  return (
    <View
      testID="suspended-notice"
      style={[styles.cover, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <ShieldAlert size={40} color="#a00" />
      <Text accessibilityRole="header" style={styles.title}>{t('banned.title')}</Text>
      <Text accessibilityRole="alert" style={styles.body}>
        {t('banned.message', { contact: PRIVACY_CONTACT })}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('banned.dismiss')}
        accessibilityState={{ disabled: busy, busy }}
        disabled={busy}
        style={[styles.button, busy && styles.dim]}
        onPress={() => void dismiss()}
      >
        <Text style={styles.buttonText}>{t('banned.dismiss')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 16, textAlign: 'center', lineHeight: 22 },
  button: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
