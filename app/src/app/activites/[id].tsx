import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

/** Placeholder until the real activity page (sub-project 5). */
export default function ActivityPlaceholder() {
  const { t } = useTranslation();
  const { title } = useLocalSearchParams<{ id: string; title?: string }>();
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {title || t('activity.placeholder.title')}
      </Text>
      <Text>{t('common.comingSoon')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 56, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
});
