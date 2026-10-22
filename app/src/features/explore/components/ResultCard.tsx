import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExploreResult } from '../types';

const LABEL_KEY = {
  very_relevant: 'explore.label.veryRelevant',
  relevant: 'explore.label.relevant',
  weak: 'explore.label.weak',
} as const;

export function ResultCard({ result, onPress }: { result: ExploreResult; onPress(): void }) {
  const { t, i18n } = useTranslation();
  const distance = t('explore.distance', {
    value: new Intl.NumberFormat(i18n.language, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(result.distanceKm),
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={result.title}
      onPress={onPress}
      style={[styles.card, result.isWeak && styles.weak]}
    >
      <View style={styles.head}>
        <Text style={styles.title}>{result.title}</Text>
        <Text style={styles.meta}>{distance}</Text>
      </View>
      {result.subtitle ? <Text style={styles.subtitle}>{result.subtitle}</Text> : null}
      <View style={styles.badges}>
        {result.label ? <Text style={styles.badge}>{t(LABEL_KEY[result.label])}</Text> : null}
        {result.isNew ? <Text style={styles.badge}>{t('explore.new')}</Text> : null}
        {result.sourceLabel ? (
          <Text style={styles.badge}>{t(`explore.source.${result.sourceLabel}`)}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', minHeight: 48 },
  weak: { opacity: 0.8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 14, color: '#555' },
  subtitle: { fontSize: 14, color: '#444', marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: {
    fontSize: 12,
    color: '#333',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
