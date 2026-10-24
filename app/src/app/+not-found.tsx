import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.text}>{t('web.notFound')}</Text>
      <Link href="/" accessibilityLabel={t('web.home')} style={styles.link}>
        {t('web.home')}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  text: { fontSize: 18, textAlign: 'center' },
  link: { color: '#1a56db', fontWeight: '600', minHeight: 44 },
});
