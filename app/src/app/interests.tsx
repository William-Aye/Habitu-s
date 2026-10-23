import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InterestPicker } from '../features/interests/InterestPicker';

export default function Interests() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('interests.title')}
      </Text>
      <InterestPicker />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
});
