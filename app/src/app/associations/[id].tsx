import { router, useLocalSearchParams } from 'expo-router';
import { Globe, Mail, Phone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addWaiter, getAssociation, removeWaiter } from '../../features/explore/api';
import { TownMap } from '../../features/explore/components/TownMap';
import type { AssociationDetail } from '../../features/explore/types';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: AssociationDetail | null };
type Wait = 'idle' | 'signed_out' | 'waiting' | 'error';

const ATTRIBUTIONS = ['rna', 'osm'] as const;

export default function AssociationPage() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [wait, setWait] = useState<Wait>('idle');
  const [soon, setSoon] = useState(false);

  useEffect(() => {
    let active = true;
    getAssociation(id)
      .then((data) => {
        if (!active) return;
        setLoad({ state: 'ready', data });
        if (data?.isWaiting) setWait('waiting');
      })
      .catch(() => active && setLoad({ state: 'error' }));
    return () => {
      active = false;
    };
  }, [id]);

  if (load.state === 'loading') {
    return <ActivityIndicator style={styles.center} accessibilityLabel={t('association.loading')} />;
  }
  if (load.state === 'error') return <Text style={styles.center}>{t('association.error')}</Text>;
  const a = load.data;
  if (!a) return <Text style={styles.center}>{t('association.notFound')}</Text>;

  const english = i18n.language?.startsWith('en');
  const place =
    a.city && a.postcode
      ? t('association.town', { city: a.city, postcode: a.postcode })
      : (a.city ?? '');
  const keys = ATTRIBUTIONS.filter((k) => a.attributionKeys.includes(k));

  const startWaiting = async () => {
    try {
      setWait((await addWaiter(a.id)) === 'added' ? 'waiting' : 'signed_out');
    } catch {
      setWait('error');
    }
  };
  const stopWaiting = async () => {
    try {
      await removeWaiter(a.id);
      setWait('idle');
    } catch {
      setWait('error');
    }
  };

  const contact = (
    Icon: typeof Globe,
    label: string,
    value: string | null,
    url: (v: string) => string,
  ) =>
    value ? (
      <Pressable
        key={label}
        accessibilityRole="link"
        accessibilityLabel={`${label} : ${value}`}
        style={styles.row}
        onPress={() => Linking.openURL(url(value))}
      >
        <Icon size={18} color="#1a56db" />
        <Text style={styles.linkText}>{value}</Text>
      </Pressable>
    ) : null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{a.name}</Text>
      <View style={styles.wrap}>
        {a.sourceLabel ? (
          <Text style={styles.badge}>{t(`explore.source.${a.sourceLabel}`)}</Text>
        ) : null}
        {a.verified ? <Text style={styles.badge}>{t('association.verified')}</Text> : null}
      </View>
      {a.purpose ? <Text>{a.purpose}</Text> : null}
      {a.tags.length > 0 ? (
        <View style={styles.wrap}>
          {a.tags.map((tag) => (
            <Text key={tag.slug} style={styles.tag}>{english ? tag.labelEn : tag.labelFr}</Text>
          ))}
        </View>
      ) : null}
      {a.lon != null && a.lat != null ? (
        <TownMap lon={a.lon} lat={a.lat} label={t('association.mapLabel', { place })} />
      ) : null}
      {place ? <Text>{place}</Text> : null}

      {a.website || a.phone || a.email || a.openingHours ? (
        <View style={styles.block}>
          {contact(Globe, t('association.website'), a.website, (v) => (/^https?:\/\//.test(v) ? v : `https://${v}`))}
          {contact(Phone, t('association.phone'), a.phone, (v) => `tel:${v.replace(/\s/g, '')}`)}
          {contact(Mail, t('association.email'), a.email, (v) => `mailto:${v}`)}
          {a.openingHours ? (
            <Text>{`${t('association.openingHours')} : ${a.openingHours}`}</Text>
          ) : null}
        </View>
      ) : null}

      {a.activities.length > 0 ? (
        <View style={styles.block}>
          <Text accessibilityRole="header" style={styles.heading}>{t('association.activities')}</Text>
          {a.activities.map((act) => (
            <Pressable
              key={act.id}
              accessibilityRole="link"
              style={styles.row}
              onPress={() =>
                router.push({ pathname: '/activites/[id]', params: { id: act.id, title: act.title } })
              }
            >
              <Text style={styles.linkText}>{act.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {a.canWait ? (
        <View style={styles.block} accessibilityLiveRegion="polite">
          {wait === 'waiting' ? (
            <View style={styles.wrap}>
              <Text>{t('association.waiting')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('association.cancelWait')}
                style={styles.link}
                onPress={stopWaiting}
              >
                <Text style={styles.linkText}>{t('association.cancelWait')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('association.waitButton')}
                style={styles.outline}
                onPress={startWaiting}
              >
                <Text style={styles.outlineText}>{t('association.waitButton')}</Text>
              </Pressable>
              {wait === 'signed_out' ? <Text>{t('association.signInToWait')}</Text> : null}
              {wait === 'error' ? <Text>{t('association.error')}</Text> : null}
            </>
          )}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('association.claim')}
        style={styles.outline}
        onPress={() => setSoon(true)}
      >
        <Text style={styles.outlineText}>{t('association.claim')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('association.report')}
        style={styles.link}
        onPress={() => setSoon(true)}
      >
        <Text style={styles.linkText}>{t('association.report')}</Text>
      </Pressable>
      {soon ? <Text accessibilityLiveRegion="polite">{t('common.comingSoon')}</Text> : null}

      {keys.map((k) => (
        <Text key={k} style={styles.source}>{t(`association.source.${k}`)}</Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { marginTop: 80, textAlign: 'center', padding: 16 },
  container: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  block: { gap: 8 },
  badge: { backgroundColor: '#eef2ff', color: '#1a3a9e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  tag: { borderWidth: 1, borderColor: '#ccc', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  source: { fontSize: 12, color: '#555' },
});
