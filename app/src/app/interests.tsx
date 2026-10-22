import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InterestPicker } from '../features/interests/InterestPicker';

export default function Interests() {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('interests.title')}
      </Text>
      <InterestPicker />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 56, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
});
