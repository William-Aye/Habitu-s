import { router, type Href } from 'expo-router';
import { List, Map, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FilterChips, effectiveKinds, type FilterState } from '../../features/explore/components/FilterChips';
import { LocationPicker } from '../../features/explore/components/LocationPicker';
import { ResultsMap } from '../../features/explore/components/ResultsMap';
import { ResultsList, WidenBanner } from '../../features/explore/components/ResultsList';
import { SearchBar } from '../../features/explore/components/SearchBar';
import type { ExploreParams, ExploreResult } from '../../features/explore/types';
import { normaliseQuery } from '../../features/explore/types';
import {
  MY_POSITION_KEY,
  useExploreLocation,
} from '../../features/explore/useExploreLocation';
import { useExploreSearch } from '../../features/explore/useExploreSearch';
import { useInterests, type Level } from '../../features/interests/store';

const LEVEL_RANK: Record<Level, number> = { curious: 1, like: 2, love: 3 };

export default function Explore() {
  const { t } = useTranslation();
  const { location, status, requestGps, setTown } = useExploreLocation();
  const { interests, loading: interestsLoading } = useInterests();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    kinds: ['activity', 'association'],
    weekday: null,
    radiusKm: 10,
    newcomerFriendly: false,
    discoveryOnly: false,
  });
  const [sort, setSort] = useState<'best' | 'nearest'>('best');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [editingLocation, setEditingLocation] = useState(false);

  const hasQuery = normaliseQuery(query) !== '';
  // Without a query the interests shape the results: wait for them so the search runs once.
  const params: ExploreParams | null = location && (hasQuery || !interestsLoading)
    ? {
        query,
        center: { lon: location.lon, lat: location.lat },
        radiusKm: filters.radiusKm,
        kinds: effectiveKinds(filters),
        weekday: filters.weekday,
        newcomerFriendly: filters.newcomerFriendly,
        discoveryOnly: filters.discoveryOnly,
        interestCategoryIds: hasQuery ? [] : Object.keys(interests),
        sort: hasQuery ? sort : 'best',
      }
    : null;
  const { response, results, loading, error, loadMoreError, loadMore, retry } =
    useExploreSearch(params);
  const widen = () => setFilters((f) => ({ ...f, radiusKm: 50 }));

  const open = (r: ExploreResult) => {
    if (r.kind === 'association') router.push({ pathname: '/associations/[id]', params: { id: r.id } });
    else if (r.kind === 'collectif') router.push({ pathname: '/collectifs/[id]', params: { id: r.id } });
    else router.push({ pathname: '/activites/[id]', params: { id: r.id, title: r.title } });
  };

  // The strongest interest decides which category the creation flow starts with.
  const topInterest = Object.entries(interests).sort(
    ([, a], [, b]) => LEVEL_RANK[b] - LEVEL_RANK[a],
  )[0]?.[0];
  const startCreating = (category?: string) =>
    router.push({
      pathname: '/activites/new',
      params: category ? { category } : {},
    });
  // "Lancez-la vous-même": interests, no activity nearby (associations may be), activities requested and
  // nothing further to load (a later page could still hold some).
  const showLaunch =
    !!topInterest && !hasQuery && !filters.discoveryOnly && !loading && !error &&
    !!response && !response.hasMore && effectiveKinds(filters).includes('activity') &&
    !results.some((r) => r.kind === 'activity');

  const needsLocation = status === 'needed' || (editingLocation && status === 'ready');
  const place = location
    ? location.source === 'gps'
      ? t(MY_POSITION_KEY)
      : location.label
    : '';

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
        onCancel={status === 'ready' ? () => setEditingLocation(false) : undefined}
      />
    );
  } else if (view === 'map') {
    body = location ? (
      <ResultsMap
        results={results}
        center={{ lon: location.lon, lat: location.lat }}
        radiusKm={filters.radiusKm}
        onOpen={open}
      />
    ) : null;
  } else if (error) {
    body = (
      <View style={styles.empty} accessibilityLiveRegion="polite">
        <Text>{t('explore.error')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('explore.retry')}
          style={styles.outline}
          onPress={retry}
        >
          <Text style={styles.outlineText}>{t('explore.retry')}</Text>
        </Pressable>
      </View>
    );
  } else if (loading && !response) {
    body = <ActivityIndicator accessibilityLabel={t('explore.loading')} />;
  } else if (response && results.length === 0) {
    body = (
      <View style={styles.empty}>
        <WidenBanner response={response} radiusKm={filters.radiusKm} onWiden={widen} />
        <Text style={styles.heading}>{t('explore.empty')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('explore.feedback')}
          style={styles.outline}
          onPress={() => router.push('/feedback' as Href)}
        >
          <Text style={styles.outlineText}>{t('explore.feedback')}</Text>
        </Pressable>
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
          loadMoreError={loadMoreError}
          onEndReached={loadMore}
          onRetryMore={loadMore}
          onWiden={widen}
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
      {location && !needsLocation ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('explore.createActivity')}
          style={styles.create}
          onPress={() => startCreating()}
        >
          <Plus size={18} color="#fff" />
          <Text style={styles.createText}>{t('explore.createActivity')}</Text>
        </Pressable>
      ) : null}
      {showLaunch && view === 'list' && !needsLocation ? (
        <View style={styles.launch}>
          <Text style={styles.launchBody}>{t('explore.launch.body')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('explore.launch.title')}
            style={styles.link}
            onPress={() => startCreating(topInterest)}
          >
            <Text style={styles.linkText}>{t('explore.launch.title')}</Text>
          </Pressable>
        </View>
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
  create: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginVertical: 4,
  },
  createText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  launch: { backgroundColor: '#eef3ff', borderRadius: 12, padding: 12, marginVertical: 4 },
  launchBody: { fontSize: 14 },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
});
