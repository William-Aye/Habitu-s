import { router, useLocalSearchParams, type Href } from 'expo-router';
import { CalendarPlus, LogOut, Pencil, Trash2, UserPlus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatSessionDate } from '../../features/activities/recurrence';
import type { ApiError, CollectifPage } from '../../features/activities/types';
import {
  answerInvitation,
  deleteCollectif,
  getCollectif,
  leaveCollectif,
  myInvitation,
} from '../../features/collectifs/api';
import { CollectifEditForm } from '../../features/collectifs/CollectifEditForm';
import { useCollectifErrorText } from '../../features/collectifs/errors';
import { InviteOrganiser } from '../../features/collectifs/InviteOrganiser';
import { OrganisersList } from '../../features/collectifs/OrganisersList';
import { TownMap } from '../../features/explore/components/TownMap';

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; collectif: CollectifPage | null; invited: boolean };

export default function CollectifScreen() {
  const { t, i18n } = useTranslation();
  const errorText = useCollectifErrorText();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);

  // Keeps the current page on screen while it is re-read, and on a failed re-read.
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true;
    (async () => {
      const r = await getCollectif(id);
      if (!active) return;
      if (!r.ok) return setLoad((cur) => (cur.state === 'ready' ? cur : { state: 'error' }));
      // A pending invitation is only looked for when I am not yet an organiser.
      const inv = r.collectif && !r.collectif.myRole ? await myInvitation(id) : null;
      if (!active) return;
      setLoad({ state: 'ready', collectif: r.collectif, invited: inv?.ok === true && inv.invited });
    })();
    return () => {
      active = false;
    };
  }, [id, version]);

  if (load.state === 'loading') {
    return <ActivityIndicator style={styles.center} accessibilityLabel={t('collectif.loading')} />;
  }
  if (load.state === 'error') {
    return (
      <View style={styles.center}>
        <Text>{t('collectif.error')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('collectif.retry')}
          style={styles.link}
          onPress={() => {
            setLoad({ state: 'loading' });
            reload();
          }}
        >
          <Text style={styles.linkText}>{t('collectif.retry')}</Text>
        </Pressable>
      </View>
    );
  }
  const c = load.collectif;
  if (!c) return <Text style={styles.center}>{t('collectif.notFound')}</Text>;

  const isOrganiser = c.myRole !== null;
  const isResponsable = c.myRole === 'responsable';

  /** Runs a write: busy while it runs, the error in the live region, `onOk` when it worked. */
  const act = async (write: () => Promise<{ ok: true } | { ok: false; error: ApiError }>, onOk: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await write();
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onOk();
  };

  const answer = (accept: boolean) =>
    act(
      () => answerInvitation(c.id, accept),
      () => {
        if (accept) {
          reload();
        } else {
          setLoad({ state: 'ready', collectif: c, invited: false });
          setNotice(t('collectif.invitation.declined'));
        }
      },
    );

  const backToProfile = () => router.replace('/profile' as Href);

  const confirmLeave = () =>
    Alert.alert(t('collectif.leaveConfirm'), t('collectif.leaveBody'), [
      { text: t('collectif.cancel'), style: 'cancel' },
      {
        text: t('collectif.leaveAction'),
        style: 'destructive',
        onPress: () => act(() => leaveCollectif(c.id), backToProfile),
      },
    ]);

  const confirmDelete = () =>
    Alert.alert(t('collectif.deleteConfirm'), t('collectif.deleteBody'), [
      { text: t('collectif.cancel'), style: 'cancel' },
      {
        text: t('collectif.deleteAction'),
        style: 'destructive',
        onPress: () => act(() => deleteCollectif(c.id), backToProfile),
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {c.name}
      </Text>
      <Text style={styles.badge}>{t('collectif.label')}</Text>

      {load.invited ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{t('collectif.invitation.banner')}</Text>
          <View style={styles.rowWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collectif.invitation.accept')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.primary, busy && styles.disabled]}
              onPress={() => answer(true)}
            >
              <Text style={styles.primaryText}>{t('collectif.invitation.accept')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collectif.invitation.decline')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.outline, busy && styles.disabled]}
              onPress={() => answer(false)}
            >
              <Text style={styles.outlineText}>{t('collectif.invitation.decline')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {editing ? (
        <CollectifEditForm
          collectif={c}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      ) : (
        <>
          {c.description ? <Text>{c.description}</Text> : null}
          <TownMap lon={c.lon} lat={c.lat} label={t('collectif.mapLabel', { place: c.townLabel })} />
          <Text>{c.townLabel}</Text>
        </>
      )}

      <Text accessibilityRole="header" style={styles.heading}>
        {t('collectif.organisers')}
      </Text>
      <OrganisersList organisers={c.organisers} />

      {isResponsable ? (
        inviting ? (
          <InviteOrganiser collectifId={c.id} onClose={() => setInviting(false)} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('collectif.invite')}
            style={[styles.outline, styles.withIcon]}
            onPress={() => setInviting(true)}
          >
            <UserPlus size={18} color="#1a56db" />
            <Text style={styles.outlineText}>{t('collectif.invite')}</Text>
          </Pressable>
        )
      ) : null}

      <Text accessibilityRole="header" style={styles.heading}>
        {t('collectif.activities')}
      </Text>
      {c.activities.length === 0 ? <Text>{t('collectif.noActivities')}</Text> : null}
      {c.activities.map((a) => (
        <Pressable
          key={a.id}
          accessibilityRole="link"
          style={styles.activity}
          onPress={() => router.push({ pathname: '/activites/[id]', params: { id: a.id, title: a.title } })}
        >
          <Text style={styles.linkText}>{a.title}</Text>
          {a.nextStartsAt ? (
            <Text style={styles.hint}>{t('collectif.next', { date: formatSessionDate(a.nextStartsAt, lang) })}</Text>
          ) : null}
        </Pressable>
      ))}

      {isOrganiser ? (
        <View style={styles.tools}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('collectif.createActivity')}
            style={[styles.primary, styles.withIcon]}
            onPress={() => router.push({ pathname: '/activites/new', params: { collectif: c.id } })}
          >
            <CalendarPlus size={18} color="#fff" />
            <Text style={styles.primaryText}>{t('collectif.createActivity')}</Text>
          </Pressable>
          {!editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collectif.edit')}
              disabled={busy}
              style={[styles.outline, styles.withIcon]}
              onPress={() => setEditing(true)}
            >
              <Pencil size={18} color="#1a56db" />
              <Text style={styles.outlineText}>{t('collectif.edit')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('collectif.leave')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[styles.outline, styles.withIcon, busy && styles.disabled]}
            onPress={confirmLeave}
          >
            <LogOut size={18} color="#1a56db" />
            <Text style={styles.outlineText}>{t('collectif.leave')}</Text>
          </Pressable>
          {isResponsable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('collectif.delete')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.danger, styles.withIcon, busy && styles.disabled]}
              onPress={confirmDelete}
            >
              <Trash2 size={18} color="#b91c1c" />
              <Text style={styles.dangerText}>{t('collectif.delete')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View accessibilityLiveRegion="polite">
        {notice ? <Text>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{errorText(error)}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { marginTop: 80, textAlign: 'center', padding: 16, alignItems: 'center' },
  container: { paddingHorizontal: 16, paddingTop: 56, paddingBottom: 32, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef2ff',
    color: '#1a3a9e',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },
  banner: { borderWidth: 1, borderColor: '#1a56db', borderRadius: 12, padding: 12, gap: 8 },
  bannerText: { fontWeight: '600' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activity: { minHeight: 48, justifyContent: 'center' },
  hint: { fontSize: 13, color: '#555' },
  tools: { gap: 8 },
  withIcon: { flexDirection: 'row', gap: 8 },
  primary: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  outlineText: { color: '#1a56db', fontSize: 16, fontWeight: '600' },
  danger: {
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#b91c1c',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dangerText: { color: '#b91c1c', fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: '#1a56db', fontWeight: '600' },
  error: { color: '#b91c1c' },
});
