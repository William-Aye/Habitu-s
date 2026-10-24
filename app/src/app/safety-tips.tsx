import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TipCard } from '../features/safety/SafetyTip';
import { TIPS, type TipId } from '../features/safety/tips';

const ORDER = Object.keys(TIPS) as TipId[];

export default function SafetyTipsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
        <Text accessibilityRole="header" style={styles.title}>{t('safety.tipsTitle')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {ORDER.map((id) => (
          <TipCard key={id} id={id} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4, paddingHorizontal: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  list: { padding: 16, gap: 12 },
});
