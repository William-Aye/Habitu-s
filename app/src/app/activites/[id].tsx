import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../../features/account/AccountGate';
import { OrganiserPanel } from '../../features/activities/OrganiserTools';
import { PersonAvatar } from '../../features/activities/PersonAvatar';
import { SessionRow } from '../../features/activities/SessionRow';
import { getActivity, joinActivity, leaveActivity } from '../../features/activities/api';
import { describeRecurrence } from '../../features/activities/recurrence';
import { shareActivity } from '../../features/activities/share';
import type { ActivityPage, ApiError } from '../../features/activities/types';
import { TownMap } from '../../features/explore/components/TownMap';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; activity: ActivityPage | null };

const KNOWN: ApiError[] = ['limit_reached', 'not_allowed', 'session_full', 'network', 'association_unavailable'];

export default function ActivityScreen() {
  const { t, i18n } = useTranslation();
  const { id, reminder } = useLocalSearchParams<{ id: string; reminder?: string }>();
  const requireAccount = useRequireAccount();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keeps the current page on screen while it is re-read, and on a failed re-read.
  const [version, setVersion] = useState(0);
  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    getActivity(id).then((r) => {
      if (!active) return;
      if (r.ok) setLoad({ state: 'ready', activity: r.activity });
      else setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'error' }));
    });
    return () => {
      active = false;
    };
  }, [id, version]);

  if (load.state === 'loading') {
    return <ActivityIndicator style={styles.center} accessibilityLabel={t('activity.loading')} />;
  }
  if (load.state === 'error') {
    return (
      <View style={styles.center}>
        <Text>{t('activity.error')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.retry')}
          style={styles.link}
          onPress={() => {
            setLoad({ state: 'loading' });
            void reload();
          }}
        >
          <Text style={styles.linkText}>{t('activity.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  const a = load.activity;
  if (!a) return <Text style={styles.center}>{t('activity.notFound')}</Text>;

  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const archived = !!a.archivedAt;
  const errorText = (e: ApiError) => t(`create.errors.${KNOWN.includes(e) ? e : 'unknown'}`);

  const act = async (call: () => Promise<{ ok: true } | { ok: false; error: ApiError }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (!r.ok) setError(errorText(r.error));
    else await reload();
  };

  const join = async () => {
    if (busy) return;
    // Signed out: ask for an account first; the page is re-read after (the visitor's view differs).
    setBusy(true);
    const ready = await requireAccount('join');
    setBusy(false);
    if (!ready) return;
    await act(() => joinActivity(a.id));
  };

  const firstConfirmed = [...a.nextSessions]
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
    .find((s) => s.myAttendance?.status === 'confirmed')?.id;
  const place = a.placeLabel;
  const category = a.category ? (lang === 'en' ? a.category.nameEn : a.category.nameFr) : null;
  const by = a.organisedBy;
  const organiserName = a.organiser?.firstName ?? '';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>{a.title}</Text>
      {reminder === 'failed' ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{t('activity.reminderFailed')}</Text>
      ) : null}
      {archived ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{t('activity.archivedNotice')}</Text> : null}

      {by ? (
        <View style={styles.block}>
          {by.kind === 'collectif' ? <Text style={styles.badge}>{t('activity.collectifLabel')}</Text> : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={
              by.kind === 'collectif'
                ? t('activity.openCollectif', { name: by.name })
                : t('activity.openAssociation', { name: by.name })
            }
            style={styles.link}
            onPress={() =>
              router.push(
                (by.kind === 'collectif' ? `/collectifs/${by.id}` : `/associations/${by.id}`) as Href,
              )
            }
          >
            <Text style={styles.linkText}>{t('activity.organisedBy', { name: by.name })}</Text>
          </Pressable>
        </View>
      ) : null}
      {a.organiser ? (
        <View style={styles.person}>
          <PersonAvatar name={organiserName} photoUrl={a.organiser.photoUrl} size={44} />
          <Text>{t(by ? 'activity.hostedBy' : 'activity.organisedBy', { name: organiserName })}</Text>
        </View>
      ) : null}

      {a.description ? <Text>{a.description}</Text> : null}
      {category ? <Text style={styles.badge}>{t('activity.category', { name: category })}</Text> : null}
      <Text>
        {describeRecurrence(a.recurrence, a.startTime, t, { startDate: a.startDate, lang })}
      </Text>

      <TownMap lon={a.lon} lat={a.lat} label={t('activity.mapLabel', { place })} />
      <Text>{t('activity.place', { place })}</Text>

      {!archived ? (
        <View style={styles.block}>
          {a.isOrganiser ? null : a.myStatus === 'none' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.join')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.primary, busy && styles.dim]}
              onPress={join}
            >
              <Text style={styles.primaryText}>{t('activity.join')}</Text>
            </Pressable>
          ) : a.myStatus === 'pending' ? (
            <View style={styles.block}>
              <Text style={styles.badge}>{t('activity.requested')}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('activity.withdraw')}
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                style={[styles.link, busy && styles.dim]}
                onPress={() => act(() => leaveActivity(a.id))}
              >
                <Text style={styles.linkText}>{t('activity.withdraw')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.leave')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.outline, busy && styles.dim]}
              onPress={() => act(() => leaveActivity(a.id))}
            >
              <Text style={styles.outlineText}>{t('activity.leave')}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('activity.share')}
            style={styles.outline}
            onPress={() => {
              void shareActivity(a.id, a.title).catch(() => {});
            }}
          >
            <Share2 size={18} color="#1a56db" />
            <Text style={styles.outlineText}>{t('activity.share')}</Text>
          </Pressable>
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}

      <Text accessibilityRole="header" style={styles.heading}>{t('activity.sessions')}</Text>
      {a.nextSessions.length === 0 ? (
        <Text>{t('activity.noSessions')}</Text>
      ) : (
        a.nextSessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            activity={a}
            showWelcome={!a.isOrganiser && a.myPastAttendanceCount === 0 && s.id === firstConfirmed}
            onChanged={reload}
          />
        ))
      )}

      {a.isOrganiser && !archived ? (
        <OrganiserPanel activity={a} onChanged={reload} onArchived={reload} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { marginTop: 80, textAlign: 'center', padding: 16, alignItems: 'center' },
  container: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  block: { gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#eef2ff', color: '#1a3a9e', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  notice: { backgroundColor: '#fef2f2', color: '#b91c1c', padding: 12, borderRadius: 8 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  dim: { opacity: 0.5 },
  error: { color: '#b91c1c' },
});
