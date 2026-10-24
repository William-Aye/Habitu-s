import { Download } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { playStoreUrl } from '../../lib/playStore';

/** Shown in place of every screen that only exists in the app. */
export function NotAvailable() {
  const { t } = useTranslation();
  const url = playStoreUrl();
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{t('web.unavailable.title')}</Text>
      <Text style={styles.body}>{t('web.unavailable.body')}</Text>
      {url ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('web.download')}
          style={styles.button}
          onPress={() => void Linking.openURL(url)}
        >
          <Download size={18} color="#fff" />
          <Text style={styles.buttonText}>{t('web.download')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: 420 },
  button: { flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
