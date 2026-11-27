import { router, useLocalSearchParams, type Href } from 'expo-router';
import Baby from 'lucide-react-native/icons/baby';
import Flag from 'lucide-react-native/icons/flag';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import Share2 from 'lucide-react-native/icons/share-2';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRequireAccount } from '../../features/account/AccountGate';
import { useSession } from '../../features/account/useSession';
import { OrganiserPanel } from '../../features/activities/OrganiserTools';
import { PersonAvatar } from '../../features/activities/PersonAvatar';
import { SessionRow } from '../../features/activities/SessionRow';
import { getActivity, joinActivity, leaveActivity } from '../../features/activities/api';
import { describeRecurrence } from '../../features/activities/recurrence';
import { shareActivity } from '../../features/activities/share';
import { KNOWN_ERRORS } from '../../features/activities/errors';
import type { ActivityPage, ApiError } from '../../features/activities/types';
import { TownMap } from '../../features/explore/components/TownMap';
import { useReportSheet } from '../../features/safety/ReportSheet';
import { SafetyTip } from '../../features/safety/SafetyTip';
import { colors } from '../../lib/theme';

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; activity: ActivityPage | null };


export default function ActivityScreen() {
  const { t, i18n } = useTranslation();
  const { id, reminder } = useLocalSearchParams<{ id: string; reminder?: string }>();
  const requireAccount = useRequireAccount();
  const { userId: me } = useSession();
  const { openReport, reportSheet } = useReportSheet();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  const errorText = (e: ApiError) => t(`create.errors.${KNOWN_ERRORS.includes(e) ? e : 'unknown'}`);

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
  // The organiser's first name and photo are for signed-in people only (the server also withholds them from anon).
  const organiserName = me ? (a.organiser?.firstName ?? '') : '';
  const organiserId = a.organiser?.id;
  const withChildren = a.withChildren;
  // What I still lack to ask to join an activity with children (the database refuses the request otherwise).
  const missing = withChildren && !a.isOrganiser && a.myStatus === 'none' ? a.childrenRequirementsMissing : [];
  const blocked = missing.length > 0;
  const joinLabel = t(a.approvalMode === 'approval' ? 'activity.requestJoin' : 'activity.join');

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
      {a.organiser && !organiserName && !by ? (
        <Text>{t('activity.organisedByMember')}</Text>
      ) : null}
      {a.organiser && organiserName ? (
        <View style={styles.person}>
          <PersonAvatar name={organiserName} photoUrl={a.organiser.photoUrl} size={44} />
          <Text>{t(by ? 'activity.hostedBy' : 'activity.organisedBy', { name: organiserName })}</Text>
          {organiserId && organiserId !== me && !a.isOrganiser ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('safety.reportPerson')}
              style={[styles.link, styles.row]}
              onPress={() => void openReport({ type: 'user', id: organiserId, withChildren })}
            >
              <Flag size={16} color={colors.accent} />
              <Text style={styles.linkText}>{t('safety.reportPerson')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {a.description ? <Text>{a.description}</Text> : null}
      {category || withChildren ? (
        <View style={styles.badges}>
          {category ? <Text style={styles.badge}>{t('activity.category', { name: category })}</Text> : null}
          {withChildren ? (
            <View style={styles.badgeRow}>
              <Baby size={16} color={colors.accentDark} />
              <Text style={styles.badgeText}>{t('activity.withChildren')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {withChildren ? <SafetyTip id="with_children" /> : null}
      <Text>
        {describeRecurrence(a.recurrence, a.startTime, t, { startDate: a.startDate, lang })}
      </Text>

      {a.placeHidden ? (
        // An activity with children: the place is given once the request is accepted.
        <Text>{t('activity.placeHidden')}</Text>
      ) : (
        <>
          {a.lon != null && a.lat != null ? (
            <TownMap lon={a.lon} lat={a.lat} label={t('activity.mapLabel', { place })} />
          ) : null}
          {place ? <Text>{t('activity.place', { place })}</Text> : null}
        </>
      )}

      {!archived ? (
        <View style={styles.block}>
          {a.isOrganiser ? null : a.myStatus === 'none' ? (
            <>
              {missing.map((m) => (
                <Text key={m} style={styles.requirement}>
                  {t(m === 'photo' && Platform.OS === 'web' ? 'activity.requirements.photoWeb' : `activity.requirements.${m}`)}
                </Text>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={joinLabel}
                accessibilityState={{ disabled: busy || blocked }}
                disabled={busy || blocked}
                style={[styles.primary, (busy || blocked) && styles.dim]}
                onPress={join}
              >
                <Text style={styles.primaryText}>{joinLabel}</Text>
              </Pressable>
            </>
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
              void shareActivity(a.id, a.title)
                .then((r) => setNotice(r === 'copied' ? t('activity.linkCopied') : null))
                .catch(() => {});
            }}
          >
            <Share2 size={18} color={colors.accent} />
            <Text style={styles.outlineText}>{t('activity.share')}</Text>
          </Pressable>
          {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}

      {a.isOrganiser || a.myStatus === 'member' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.discussion')}
          style={styles.outline}
          onPress={() => router.push(`/discussions/${a.id}` as Href)}
        >
          <MessageCircle size={18} color={colors.accent} />
          <Text style={styles.outlineText}>{t('activity.discussion')}</Text>
        </Pressable>
      ) : null}

      {!a.isOrganiser ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('safety.reportActivity')}
          style={[styles.link, styles.row]}
          onPress={() => void openReport({ type: 'activity', id: a.id, withChildren })}
        >
          <Flag size={16} color={colors.accent} />
          <Text style={styles.linkText}>{t('safety.reportActivity')}</Text>
        </Pressable>
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
            showFirstTip={!a.isOrganiser && a.myPastAttendanceCount === 0 && s.id === firstConfirmed}
            onChanged={reload}
          />
        ))
      )}

      {a.isOrganiser && !archived ? (
        <OrganiserPanel activity={a} onChanged={reload} onArchived={reload} />
      ) : null}
      {reportSheet}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { marginTop: 80, textAlign: 'center', padding: 16, alignItems: 'center' },
  container: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  block: { gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, color: colors.accentDark, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accentSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: colors.accentDark },
  requirement: { color: colors.warningText },
  notice: { backgroundColor: '#fef2f2', color: colors.danger, padding: 12, borderRadius: 8 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: colors.accent, fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  outlineText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  dim: { opacity: 0.5 },
  error: { color: colors.danger },
});
