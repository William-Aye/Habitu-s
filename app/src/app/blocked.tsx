import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireAccount } from '../features/account/AccountGate';
import { useSession } from '../features/account/useSession';
import { BlockedList } from '../features/safety/BlockedList';

export default function BlockedScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { status } = useSession();
  const requireAccount = useRequireAccount();
  // Signed out: the account gate, once. Declining it leaves the screen.
  const signedOut = status === 'signed_out' || status === 'needs_profile';
  const asked = useRef(false);
  useEffect(() => {
    if (!signedOut || asked.current) return;
    asked.current = true;
    void requireAccount('join').then((ok) => {
      if (!ok) router.back();
    });
  }, [signedOut, requireAccount]);
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('safety.back')}
          style={styles.iconButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} color="#1a56db" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{t('safety.blockedTitle')}</Text>
      </View>
      {status === 'ready' ? <BlockedList /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4, paddingHorizontal: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
});
