import { router } from 'expo-router';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedbackForm } from '../features/feedback/FeedbackForm';
import { colors } from '../lib/theme';

export default function FeedbackScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('feedback.back')}
          style={styles.iconButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} color={colors.accent} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{t('feedback.title')}</Text>
      </View>
      <FeedbackForm />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4, paddingHorizontal: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
});
