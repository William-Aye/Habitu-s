import { router, useFocusEffect } from 'expo-router';
import { Check, Compass, Plus } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../features/account/useSession';
import { myActivities, setAttendance } from '../../features/activities/api';
import { formatSessionDate } from '../../features/activities/recurrence';
import type { MyActivity } from '../../features/activities/types';
import { askForPush } from '../../features/notifications/registerPush';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; items: MyActivity[] };

export default function MyActivities() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const { status } = useSession();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState(false);

  const requestId = useRef(0);
  const refresh = useCallback(() => {
    if (status === 'loading') return;
    if (status !== 'ready') {
      setLoad({ state: 'ready', items: [] });
      return;
    }
    const id = ++requestId.current;
    myActivities().then((r) => {
      if (id !== requestId.current) return; // a newer read or a blur superseded this one
      if (r.ok) {
        setLoad({ state: 'ready', items: r.activities });
        setRefreshFailed(false);
      } else {
        // Keep a list that is already on screen (a failed refresh after an answer must not hide it).
        setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'error' }));
        setRefreshFailed(true);
      }
    });
  }, [status]);

  // Re-read each time the tab is shown again: confirmations made elsewhere change the cards.
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        requestId.current++;
      };
    }, [refresh]),
  );

  const confirm = async (sessionId: string) => {
    if (busyIds.includes(sessionId)) return;
    setBusyIds((ids) => [...ids, sessionId]);
    setActionError(false);
    const r = await setAttendance(sessionId, 'confirmed', 0);
    setBusyIds((ids) => ids.filter((x) => x !== sessionId));
    if (!r.ok) {
      setActionError(true);
      return;
    }
    refresh();
    void askForPush();
  };

  if (load.state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator accessibilityLabel={t('mine.loading')} />
      </View>
    );
  }

  if (load.state === 'error') {
    return (
      <View style={styles.center}>
        <Text accessibilityLiveRegion="polite">{t('mine.error')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mine.retry')}
          style={styles.outline}
          onPress={() => {
            setLoad({ state: 'loading' });
            refresh();
          }}
        >
          <Text style={styles.outlineText}>{t('mine.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const organising = load.items.filter((a) => a.isOrganiser);
  const participating = load.items.filter((a) => !a.isOrganiser);

  if (load.items.length === 0) {
    return (
      <View style={styles.center}>
        <Text accessibilityRole="header" style={styles.title}>{t('tabs.myActivities')}</Text>
        <Text>{t('mine.empty')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mine.create')}
          style={styles.primary}
          onPress={() => router.push('/activites/new')}
        >
          <Plus size={18} color="#fff" />
          <Text style={styles.primaryText}>{t('mine.create')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('mine.explore')}
          style={styles.outline}
          onPress={() => router.replace('/')}
        >
          <Compass size={18} color="#1a56db" />
          <Text style={styles.outlineText}>{t('mine.explore')}</Text>
        </Pressable>
      </View>
    );
  }

  const card = (a: MyActivity) => {
    const s = a.nextSession;
    const date = s ? formatSessionDate(s.startsAt, lang) : '';
    const confirmed = s?.myAttendance?.status === 'confirmed';
    const canConfirm =
      !!s && s.status === 'scheduled' && a.myStatus === 'member' && !confirmed && !s.isFull;
    const busy = !!s && busyIds.includes(s.id);
    return (
      <View key={a.id} style={styles.card}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('mine.open', { title: a.title })}
          onPress={() => router.push({ pathname: '/activites/[id]', params: { id: a.id } })}
        >
          <Text style={styles.cardTitle}>{a.title}</Text>
        </Pressable>
        <Text>{a.placeLabel}</Text>
        {a.myStatus === 'pending' ? <Text style={styles.badge}>{t('mine.requested')}</Text> : null}
        <Text>{s ? t('mine.next', { date }) : t('mine.noSession')}</Text>
        {confirmed ? (
          <View style={styles.row}>
            <Check size={18} color="#047857" />
            <Text style={styles.confirmed}>{t('mine.confirmed')}</Text>
          </View>
        ) : null}
        {canConfirm ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mine.imThereAria', { date })}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[styles.primary, busy && styles.dim]}
            onPress={() => confirm(s.id)}
          >
            <Text style={styles.primaryText}>{t('mine.imThere')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>{t('tabs.myActivities')}</Text>
      {refreshFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{t('mine.error')}</Text>
      ) : null}
      {actionError ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{t('mine.actionError')}</Text>
      ) : null}
      {organising.length > 0 ? (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.heading}>{t('mine.organising')}</Text>
          {organising.map(card)}
        </View>
      ) : null}
      {participating.length > 0 ? (
        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.heading}>{t('mine.participating')}</Text>
          {participating.map(card)}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  group: { gap: 10 },
  heading: { fontSize: 18, fontWeight: '600' },
  card: { gap: 6, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },
  cardTitle: { fontSize: 16, fontWeight: '600', minHeight: 44, textAlignVertical: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#eef2ff', color: '#1a3a9e', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, overflow: 'hidden' },
  confirmed: { color: '#047857', fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  dim: { opacity: 0.5 },
  error: { color: '#b91c1c' },
});
