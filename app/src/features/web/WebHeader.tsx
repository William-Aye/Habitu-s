import { router, type Href } from 'expo-router';
import { Download } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { playStoreUrl } from '../../lib/playStore';
import { signOut } from '../account/auth';
import { useSession } from '../account/useSession';

/** Slim bar above every web page: the name, the account links when signed in, and a way to the Play Store. */
export function WebHeader() {
  const { t } = useTranslation();
  const url = playStoreUrl();
  const { status } = useSession();
  const signedIn = status === 'ready' || status === 'needs_profile';
  return (
    <View style={styles.bar} accessibilityRole="banner">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('web.siteName')}
        style={styles.name}
        onPress={() => router.push('/' as Href)}
      >
        <Text style={styles.nameText}>{t('web.siteName')}</Text>
      </Pressable>
      {signedIn ? (
        <View style={styles.account}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('web.account')}
            style={styles.accountLink}
            onPress={() => router.push('/profile' as Href)}
          >
            <Text style={styles.downloadText}>{t('web.account')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.signOut')}
            style={styles.accountLink}
            onPress={() => void signOut()}
          >
            <Text style={styles.downloadText}>{t('profile.signOut')}</Text>
          </Pressable>
        </View>
      ) : null}
      {url ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('web.download')}
          style={styles.download}
          onPress={() => void Linking.openURL(url)}
        >
          <Download size={16} color="#1a56db" />
          <Text style={styles.downloadText}>{t('web.download')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 48, flexWrap: 'wrap', gap: 4, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#fff' },
  name: { minHeight: 44, justifyContent: 'center' },
  nameText: { fontSize: 18, fontWeight: '700', color: '#1a3a9e' },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  accountLink: { minHeight: 44, justifyContent: 'center' },
  download: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  downloadText: { color: '#1a56db', fontWeight: '600' },
});
