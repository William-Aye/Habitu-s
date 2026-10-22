import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExploreResponse, ExploreResult, Radius } from '../types';
import { ResultCard } from './ResultCard';

type Row = { type: 'card'; result: ExploreResult } | { type: 'divider' };

export function ResultsList({
  response,
  results,
  radiusKm = 10,
  onEndReached,
  onWiden,
  onOpen,
}: {
  response: ExploreResponse | null;
  results: ExploreResult[];
  radiusKm?: Radius;
  onEndReached(): void;
  onWiden(): void;
  onOpen(result: ExploreResult): void;
}) {
  const { t } = useTranslation();
  const rows: Row[] = [];
  let dividerDone = false;
  for (const result of results) {
    if (result.isWeak && !dividerDone) {
      rows.push({ type: 'divider' });
      dividerDone = true;
    }
    rows.push({ type: 'card', result });
  }

  const banner =
    response && response.suggestRadiusKm === 50 ? (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          {t('explore.widen', {
            count: response.strongCount,
            radius: radiusKm,
            wide: response.strongCount50km,
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('explore.widenAction')}
          onPress={onWiden}
          style={styles.bannerButton}
        >
          <Text style={styles.bannerAction}>{t('explore.widenAction')}</Text>
        </Pressable>
      </View>
    ) : null;

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => (r.type === 'divider' ? 'divider' : `${r.result.kind}:${r.result.id}`)}
      ListHeaderComponent={banner ?? undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) =>
        item.type === 'divider' ? (
          <Text style={styles.divider} accessibilityRole="header">
            {t('explore.weakDivider')}
          </Text>
        ) : (
          <ResultCard result={item.result} onPress={() => onOpen(item.result)} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: '#eef3ff', borderRadius: 12, padding: 12, marginBottom: 8, gap: 8 },
  bannerText: { fontSize: 14 },
  bannerButton: { minHeight: 44, justifyContent: 'center' },
  bannerAction: { fontSize: 14, fontWeight: '600', color: '#1a56db' },
  divider: { fontSize: 13, color: '#555', paddingTop: 16, paddingBottom: 4 },
});
