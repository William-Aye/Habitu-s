import { router } from 'expo-router';
import { List, Map } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FilterChips, effectiveKinds, type FilterState } from '../../features/explore/components/FilterChips';
import { LocationPicker } from '../../features/explore/components/LocationPicker';
import { ResultsList } from '../../features/explore/components/ResultsList';
import { SearchBar } from '../../features/explore/components/SearchBar';
import type { ExploreParams, ExploreResult } from '../../features/explore/types';
import { normaliseQuery } from '../../features/explore/types';
import {
  MY_POSITION_KEY,
  useExploreLocation,
} from '../../features/explore/useExploreLocation';
import { useExploreSearch } from '../../features/explore/useExploreSearch';

export default function Explore() {
  const { t } = useTranslation();
  const { location, status, requestGps, setTown } = useExploreLocation();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    kinds: ['activity', 'association'],
    weekday: null,
    radiusKm: 10,
    newcomerFriendly: false,
  });
  const [sort, setSort] = useState<'best' | 'nearest'>('best');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [editingLocation, setEditingLocation] = useState(false);
  const [notice, setNotice] = useState(false);

  const hasQuery = normaliseQuery(query) !== '';
  const params: ExploreParams | null = location
    ? {
        query,
        center: { lon: location.lon, lat: location.lat },
        radiusKm: filters.radiusKm,
        kinds: effectiveKinds(filters),
        weekday: filters.weekday,
        newcomerFriendly: filters.newcomerFriendly,
        interestCategoryIds: [],
        sort: hasQuery ? sort : 'best',
      }
    : null;
  const { response, results, loading, error, loadMore } = useExploreSearch(params);

  const open = (r: ExploreResult) =>
    router.push((r.kind === 'association' ? `/associations/${r.id}` : `/activites/${r.id}`) as never);

  const needsLocation = status === 'needed' || (editingLocation && status === 'ready');
  const place = location
    ? location.source === 'gps'
      ? t(MY_POSITION_KEY)
      : location.label
    : '';

  const comingSoon = (
    <Pressable accessibilityRole="button" style={styles.outline} onPress={() => setNotice(true)}>
      <Text style={styles.outlineText}>{t('explore.createActivity')}</Text>
    </Pressable>
  );

  let body: React.ReactNode = null;
  if (status === 'loading') {
    body = <ActivityIndicator accessibilityLabel={t('explore.loading')} />;
  } else if (needsLocation) {
    body = (
      <LocationPicker
        onGps={async () => {
          const r = await requestGps();
          if (r === 'ok') setEditingLocation(false);
          return r;
        }}
        onTown={async (town) => {
          await setTown(town);
          setEditingLocation(false);
        }}
      />
    );
  } else if (view === 'map') {
    body = null; // map view arrives with the map task
  } else if (error) {
    body = <Text>{t('explore.error')}</Text>;
  } else if (loading && !response) {
    body = <ActivityIndicator accessibilityLabel={t('explore.loading')} />;
  } else if (response && results.length === 0) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.heading}>{t('explore.empty')}</Text>
        {comingSoon}
        <Pressable accessibilityRole="button" style={styles.outline} onPress={() => setNotice(true)}>
          <Text style={styles.outlineText}>{t('explore.feedback')}</Text>
        </Pressable>
        {notice ? <Text accessibilityLiveRegion="polite">{t('common.comingSoon')}</Text> : null}
      </View>
    );
  } else {
    body = (
      <>
        {!hasQuery ? <Text style={styles.heading}>{t('explore.nearby')}</Text> : null}
        <ResultsList
          response={response}
          results={results}
          radiusKm={filters.radiusKm}
          onEndReached={loadMore}
          onWiden={() => setFilters((f) => ({ ...f, radiusKm: 50 }))}
          onOpen={open}
        />
      </>
    );
  }

  return (
    <View style={styles.container}>
      <SearchBar value={query} onChange={setQuery} />
      <FilterChips params={filters} onChange={(p) => setFilters((f) => ({ ...f, ...p }))} />
      {location && !needsLocation ? (
        <>
          <View style={styles.row}>
            <Text style={styles.place}>{t('explore.location.around', { place })}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('explore.location.edit')}
              style={styles.link}
              onPress={() => setEditingLocation(true)}
            >
              <Text style={styles.linkText}>{t('explore.location.edit')}</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            {hasQuery ? (
              <View style={styles.row}>
                {(['best', 'nearest'] as const).map((s) => (
                  <Pressable
                    key={s}
                    accessibilityRole="button"
                    accessibilityLabel={t(`explore.sort.${s}`)}
                    accessibilityState={{ selected: sort === s }}
                    style={[styles.seg, sort === s && styles.segOn]}
                    onPress={() => setSort(s)}
                  >
                    <Text style={sort === s ? styles.segTextOn : undefined}>
                      {t(`explore.sort.${s}`)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View />
            )}
            <View style={styles.row}>
              {(['list', 'map'] as const).map((v) => {
                const Icon = v === 'list' ? List : Map;
                const on = view === v;
                return (
                  <Pressable
                    key={v}
                    accessibilityRole="button"
                    accessibilityLabel={t(`explore.view.${v}`)}
                    accessibilityState={{ selected: on }}
                    style={[styles.seg, on && styles.segOn]}
                    onPress={() => setView(v)}
                  >
                    <Icon size={16} color={on ? '#fff' : '#222'} />
                    <Text style={on ? styles.segTextOn : undefined}>{t(`explore.view.${v}`)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </>
      ) : null}
      {notice && !(response && results.length === 0) ? (
        <Text accessibilityLiveRegion="polite">{t('common.comingSoon')}</Text>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: 56 },
  body: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  place: { fontSize: 14, flexShrink: 1 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  seg: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  segOn: { backgroundColor: '#1a56db', borderColor: '#1a56db' },
  segTextOn: { color: '#fff' },
  heading: { fontSize: 18, fontWeight: '600', paddingVertical: 8 },
  empty: { gap: 12, paddingVertical: 16 },
  outline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
});
