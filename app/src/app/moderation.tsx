import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireAccount } from '../features/account/AccountGate';
import { useSession } from '../features/account/useSession';
import {
  fetchModerationNotices,
  markSeen,
  noticeIds,
  readSeen,
  type ModerationNotices,
} from '../features/safety/notices';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; notices: ModerationNotices; fresh: Set<string> };

export default function ModerationScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { status, userId } = useSession();
  const requireAccount = useRequireAccount();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [version, setVersion] = useState(0);

  // Signed out: the account gate, once. Declining it leaves the screen.
  const signedOut = status === 'signed_out' || status === 'needs_profile';
  const asked = useRef(false);
  useEffect(() => {
    if (!signedOut || asked.current) return;
    asked.current = true;
    void requireAccount('join').then((ok) => {
      if (!ok) router.back();
    });
  }, [signedOut, requireAccount]);

  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    let active = true;
    (async () => {
      const r = await fetchModerationNotices();
      if (!active) return;
      if (!r.ok) return setLoad({ state: 'error' });
      const seen = await readSeen(userId);
      if (!active) return;
      const ids = noticeIds(r.notices);
      setLoad({ state: 'ready', notices: r.notices, fresh: new Set(ids.filter((id) => !seen.has(id))) });
      void markSeen(userId, ids);
    })();
    return () => {
      active = false;
    };
  }, [status, userId, version]);

  const retry = useCallback(() => {
    setLoad({ state: 'loading' });
    setVersion((v) => v + 1);
  }, []);

  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language?.startsWith('en') ? 'en-GB' : 'fr-FR') : '';

  let body: React.ReactNode = null;
  if (status === 'loading') {
    body = <ActivityIndicator style={styles.center} accessibilityLabel={t('moderation.loading')} />;
  } else if (status === 'ready') {
    if (load.state === 'loading') {
      body = <ActivityIndicator style={styles.center} accessibilityLabel={t('moderation.loading')} />;
    } else if (load.state === 'error') {
      body = (
        <View style={styles.center}>
          <Text accessibilityLiveRegion="polite">{t('moderation.error')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('moderation.retry')}
            style={styles.link}
            onPress={retry}
          >
            <Text style={styles.linkText}>{t('moderation.retry')}</Text>
          </Pressable>
        </View>
      );
    } else {
      const { decisions, handledReports } = load.notices;
      body = (
        <ScrollView contentContainerStyle={styles.container}>
          {decisions.length === 0 && handledReports.length === 0 ? <Text>{t('moderation.empty')}</Text> : null}
          {decisions.length > 0 ? (
            <Text accessibilityRole="header" style={styles.section}>{t('moderation.decisionsTitle')}</Text>
          ) : null}
          {decisions.map((d) => (
            <View
              key={`d:${d.reportId}`}
              style={styles.card}
              accessible
              accessibilityLabel={t('moderation.decisionAria', {
                decision: t(`moderation.decision.${d.decision}`),
                target: t(`moderation.target.${d.targetType}`),
                date: date(d.decidedAt),
                reasons: d.statementOfReasons,
              })}
            >
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{t(`moderation.decision.${d.decision}`)}</Text>
                {load.fresh.has(`d:${d.reportId}`) ? <Text style={styles.badge}>{t('moderation.new')}</Text> : null}
              </View>
              <Text style={styles.meta}>
                {t(`moderation.target.${d.targetType}`)} - {date(d.decidedAt)}
              </Text>
              <Text style={styles.label}>{t('moderation.reasonsLabel')}</Text>
              <Text>{d.statementOfReasons}</Text>
            </View>
          ))}
          {handledReports.length > 0 ? (
            <Text accessibilityRole="header" style={styles.section}>{t('moderation.reportsTitle')}</Text>
          ) : null}
          {handledReports.map((r) => (
            <View key={`r:${r.reportId}`} style={styles.card} accessible accessibilityLabel={`${t('moderation.reportHandled')} ${date(r.decidedAt)}`}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>{t('moderation.reportHandled')}</Text>
                {load.fresh.has(`r:${r.reportId}`) ? <Text style={styles.badge}>{t('moderation.new')}</Text> : null}
              </View>
              <Text style={styles.meta}>{date(r.decidedAt)}</Text>
            </View>
          ))}
        </ScrollView>
      );
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('moderation.back')}
          style={styles.iconButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={24} color="#1a56db" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title}>{t('moderation.title')}</Text>
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4, paddingHorizontal: 4 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', flex: 1 },
  center: { marginTop: 80, padding: 16, alignItems: 'center', gap: 12 },
  container: { padding: 16, gap: 12 },
  section: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12, gap: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  badge: { backgroundColor: '#1a56db', color: '#fff', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  meta: { color: '#6b7280', fontSize: 13 },
  label: { fontWeight: '600', marginTop: 6 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
});
