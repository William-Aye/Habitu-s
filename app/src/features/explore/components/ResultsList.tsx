import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ExploreResponse, ExploreResult, Radius } from '../types';
import { ResultCard } from './ResultCard';

type Row = { type: 'card'; result: ExploreResult } | { type: 'divider' };

/** "N résultats pertinents à R km — M à 50 km" + "Élargir à 50 km", when the server suggests it. */
export function WidenBanner({
  response,
  radiusKm,
  onWiden,
}: {
  response: ExploreResponse | null;
  radiusKm: Radius;
  onWiden(): void;
}) {
  const { t } = useTranslation();
  if (!response || response.suggestRadiusKm !== 50) return null;
  return (
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
  );
}

export function ResultsList({
  response,
  results,
  radiusKm = 10,
  loadMoreError = false,
  onEndReached,
  onRetryMore,
  onWiden,
  onOpen,
}: {
  response: ExploreResponse | null;
  results: ExploreResult[];
  radiusKm?: Radius;
  /** The next page failed: keep the list, show an inline retry at its end. */
  loadMoreError?: boolean;
  onEndReached(): void;
  onRetryMore?(): void;
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

  const footer = loadMoreError ? (
    <View style={styles.footer} accessibilityLiveRegion="polite">
      <Text>{t('explore.error')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('explore.retry')}
        onPress={onRetryMore}
        style={styles.bannerButton}
      >
        <Text style={styles.bannerAction}>{t('explore.retry')}</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => (r.type === 'divider' ? 'divider' : `${r.result.kind}:${r.result.id}`)}
      ListHeaderComponent={<WidenBanner response={response} radiusKm={radiusKm} onWiden={onWiden} />}
      ListFooterComponent={footer ?? undefined}
      // After a failed page, wait for the retry button instead of re-requesting on every scroll.
      onEndReached={loadMoreError ? undefined : onEndReached}
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
  footer: { paddingVertical: 12, gap: 4 },
  divider: { fontSize: 13, color: '#555', paddingTop: 16, paddingBottom: 4 },
});
