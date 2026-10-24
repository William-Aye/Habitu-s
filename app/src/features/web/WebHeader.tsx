import { router, type Href } from 'expo-router';
import { Download } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { playStoreUrl } from '../../lib/playStore';

/** Slim bar above every web page: the name, and a way to the Play Store. */
export function WebHeader() {
  const { t } = useTranslation();
  const url = playStoreUrl();
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
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#fff' },
  name: { minHeight: 44, justifyContent: 'center' },
  nameText: { fontSize: 18, fontWeight: '700', color: '#1a3a9e' },
  download: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  downloadText: { color: '#1a56db', fontWeight: '600' },
});
