import { Archive, Check, Pencil, UserCheck, X } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSession } from '../account/useSession';
import { PersonAvatar } from './PersonAvatar';
import {
  activityRoster,
  archiveActivity,
  decideJoinRequest,
  getChatHistory,
  setChatHistory,
  setWelcomeMember,
  updateSession,
  type RosterEntry,
} from './api';
import { isRealDate, isValidTime, PLACE_LABEL_MAX } from './form';
import { instantOf, wallTime } from './time';
import type { ActivityPage, ApiError, ChatHistory, SessionInfo } from './types';

const KNOWN: ApiError[] = ['limit_reached', 'not_allowed', 'session_full', 'network', 'association_unavailable'];

function useErrorText() {
  const { t } = useTranslation();
  return (e: ApiError) => t(`create.errors.${KNOWN.includes(e) ? e : 'unknown'}`);
}

interface PanelProps {
  activity: ActivityPage;
  /** Re-reads the activity page. */
  onChanged: () => void;
  /** The activity was archived. */
  onArchived: () => void;
}

/** Requests to join, welcome person and archiving: shown to the organiser only. */
export function OrganiserPanel({ activity, onChanged, onArchived }: PanelProps) {
  const { t } = useTranslation();
  const { userId } = useSession();
  const errorText = useErrorText();
  const [people, setPeople] = useState<RosterEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [history, setHistory] = useState<ChatHistory>('all');
  useEffect(() => {
    let active = true;
    getChatHistory(activity.id).then((r) => {
      if (active && r.ok) setHistory(r.chatHistory);
    });
    return () => {
      active = false;
    };
  }, [activity.id]);
  const chooseHistory = (next: ChatHistory) =>
    run(() => setChatHistory(activity.id, next), () => setHistory(next));

  const [rosterKey, setRosterKey] = useState(0);
  const loadRoster = useCallback(async () => setRosterKey((k) => k + 1), []);
  useEffect(() => {
    let active = true;
    activityRoster(activity.id).then((r) => {
      if (!active) return;
      if (r.ok) {
        setPeople(r.people);
        setRosterError(null);
      } else {
        setRosterError(errorText(r.error));
      }
    });
    return () => {
      active = false;
    };
    // errorText only reads translations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id, rosterKey]);

  const run = async (call: () => Promise<{ ok: true } | { ok: false; error: ApiError }>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    await loadRoster();
    onChanged();
    after?.();
  };

  const pending = people.filter((p) => p.status === 'pending');
  const members = people.filter((p) => p.status === 'member');

  return (
    <View style={styles.panel} accessibilityLabel={t('activity.organiser.tools')}>
      <Text accessibilityRole="header" style={styles.heading}>{t('activity.organiser.tools')}</Text>

      <Text accessibilityRole="header" style={styles.subheading}>{t('activity.organiser.requests')}</Text>
      {rosterError ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>{rosterError}</Text>
      ) : pending.length === 0 ? (
        <Text>{t('activity.organiser.noRequests')}</Text>
      ) : (
        pending.map((p) => (
          <View key={p.userId} style={styles.line}>
            <PersonAvatar name={p.firstName} photoUrl={p.photoUrl} />
            <Text style={styles.grow}>{p.firstName}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.organiser.acceptAria', { name: p.firstName })}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.small, busy && styles.dim]}
              onPress={() => run(() => decideJoinRequest(activity.id, p.userId, true))}
            >
              <Check size={16} color="#1a56db" />
              <Text style={styles.smallText}>{t('activity.organiser.accept')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.organiser.refuseAria', { name: p.firstName })}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.small, busy && styles.dim]}
              onPress={() => run(() => decideJoinRequest(activity.id, p.userId, false))}
            >
              <X size={16} color="#1a56db" />
              <Text style={styles.smallText}>{t('activity.organiser.refuse')}</Text>
            </Pressable>
          </View>
        ))
      )}

      <Text accessibilityRole="header" style={styles.subheading}>{t('activity.organiser.welcome')}</Text>
      <Text style={styles.hint}>{t('activity.organiser.welcomeHint')}</Text>
      {activity.welcomeFirstName ? (
        <Text>{t('activity.organiser.welcomeNow', { prenom: activity.welcomeFirstName })}</Text>
      ) : null}
      <View style={styles.wrap}>
        {[
          ...(userId ? [{ id: userId as string | null, name: t('activity.organiser.welcomeMe') }] : []),
          ...members.map((m) => ({ id: m.userId as string | null, name: m.firstName })),
          { id: null as string | null, name: t('activity.organiser.welcomeNobody') },
        ].map((o) => (
          <Pressable
            key={o.id ?? 'nobody'}
            accessibilityRole="button"
            accessibilityLabel={`${t('activity.organiser.welcome')} : ${o.name}`}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            style={[styles.chip, busy && styles.dim]}
            onPress={() => run(() => setWelcomeMember(activity.id, o.id))}
          >
            <UserCheck size={14} color="#1a56db" />
            <Text style={styles.smallText}>{o.name}</Text>
          </Pressable>
        ))}
      </View>

      <Text accessibilityRole="header" style={styles.subheading}>{t('activity.organiser.history')}</Text>
      <Text style={styles.hint}>{t('activity.organiser.historyHint')}</Text>
      <View style={styles.wrap} accessibilityRole="radiogroup">
        {(['all', 'since_join'] as const).map((h) => {
          const on = history === h;
          const label = t(`create.settings.history_${h}`);
          return (
            <Pressable
              key={h}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ selected: on, disabled: busy }}
              disabled={busy}
              style={[styles.chip, on && styles.chipOn, busy && styles.dim]}
              onPress={() => (on ? undefined : chooseHistory(h))}
            >
              <Text style={[styles.smallText, on && styles.chipOnText]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {confirmArchive ? (
        <View style={styles.confirm} accessibilityLiveRegion="polite">
          <Text>{t('activity.organiser.archiveAsk')}</Text>
          <View style={styles.wrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.organiser.archiveYes')}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.danger, busy && styles.dim]}
              onPress={() => run(() => archiveActivity(activity.id), onArchived)}
            >
              <Text style={styles.dangerText}>{t('activity.organiser.archiveYes')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.organiser.archiveNo')}
              style={styles.small}
              onPress={() => setConfirmArchive(false)}
            >
              <Text style={styles.smallText}>{t('activity.organiser.archiveNo')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.organiser.archive')}
          style={styles.outline}
          onPress={() => setConfirmArchive(true)}
        >
          <Archive size={18} color="#b91c1c" />
          <Text style={styles.dangerOutlineText}>{t('activity.organiser.archive')}</Text>
        </Pressable>
      )}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

interface SessionToolsProps {
  session: SessionInfo;
  activity: Pick<ActivityPage, 'timezone'>;
  onChanged: () => void;
}

/** Per-session organiser actions: reschedule, change the place, discovery mark, cancel. */
export function SessionTools({ session, activity, onChanged }: SessionToolsProps) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const wall = wallTime(session.startsAt, activity.timezone);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(wall.date);
  const [time, setTime] = useState(wall.time);
  const [place, setPlace] = useState(session.placeLabel);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (call: () => Promise<{ ok: true } | { ok: false; error: ApiError }>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await call();
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    after?.();
    onChanged();
  };

  const save = () => {
    const label = place.trim();
    if (!isRealDate(date) || !isValidTime(time) || label.length === 0 || label.length > PLACE_LABEL_MAX) {
      setError(t('activity.organiser.invalid'));
      return;
    }
    const startsAt = instantOf(date, time, activity.timezone);
    if (new Date(startsAt).getTime() <= Date.now()) {
      setError(t('activity.organiser.invalid'));
      return;
    }
    const patch: { startsAt?: string; placeLabel?: string } = {};
    if (startsAt !== new Date(session.startsAt).toISOString()) patch.startsAt = startsAt;
    if (label !== session.placeLabel) patch.placeLabel = label;
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    void run(() => updateSession(session.id, patch), () => setEditing(false));
  };

  const disabled = { disabled: busy };
  return (
    <View style={styles.tools}>
      <View style={styles.wrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.organiser.editSession')}
          accessibilityState={{ expanded: editing }}
          style={styles.small}
          onPress={() => {
            if (!editing) {
              const w = wallTime(session.startsAt, activity.timezone);
              setDate(w.date);
              setTime(w.time);
              setPlace(session.placeLabel);
            }
            setEditing((v) => !v);
            setError(null);
          }}
        >
          <Pencil size={16} color="#1a56db" />
          <Text style={styles.smallText}>{t('activity.organiser.editSession')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={session.isDiscovery ? t('activity.organiser.unmarkDiscovery') : t('activity.organiser.markDiscovery')}
          accessibilityState={disabled}
          disabled={busy}
          style={[styles.small, busy && styles.dim]}
          onPress={() => run(() => updateSession(session.id, { isDiscovery: !session.isDiscovery }))}
        >
          <Text style={styles.smallText}>
            {session.isDiscovery ? t('activity.organiser.unmarkDiscovery') : t('activity.organiser.markDiscovery')}
          </Text>
        </Pressable>
      </View>

      {editing ? (
        <View style={styles.form}>
          <TextInput
            accessibilityLabel={t('activity.organiser.date')}
            placeholder={t('activity.organiser.date')}
            value={date}
            onChangeText={setDate}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            accessibilityLabel={t('activity.organiser.time')}
            placeholder={t('activity.organiser.time')}
            value={time}
            onChangeText={setTime}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            accessibilityLabel={t('activity.organiser.placeLabel')}
            placeholder={t('activity.organiser.placeLabel')}
            value={place}
            onChangeText={setPlace}
            maxLength={PLACE_LABEL_MAX}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? t('activity.organiser.saving') : t('activity.organiser.save')}
            accessibilityState={disabled}
            disabled={busy}
            style={[styles.primary, busy && styles.dim]}
            onPress={save}
          >
            <Text style={styles.primaryText}>{t('activity.organiser.save')}</Text>
          </Pressable>
        </View>
      ) : null}

      {confirmCancel ? (
        <View style={styles.wrap} accessibilityLiveRegion="polite">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('activity.organiser.confirmCancelSession')}
            accessibilityState={disabled}
            disabled={busy}
            style={[styles.danger, busy && styles.dim]}
            onPress={() => run(() => updateSession(session.id, { status: 'cancelled_by_organiser' }))}
          >
            <Text style={styles.dangerText}>{t('activity.organiser.confirmCancelSession')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('activity.organiser.keepSession')}
            style={styles.small}
            onPress={() => setConfirmCancel(false)}
          >
            <Text style={styles.smallText}>{t('activity.organiser.keepSession')}</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.organiser.cancelSession')}
          style={styles.small}
          onPress={() => setConfirmCancel(true)}
        >
          <X size={16} color="#b91c1c" />
          <Text style={styles.dangerOutlineText}>{t('activity.organiser.cancelSession')}</Text>
        </Pressable>
      )}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 16 },
  tools: { gap: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8 },
  heading: { fontSize: 18, fontWeight: '600' },
  subheading: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  hint: { fontSize: 13, color: '#555' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  grow: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  small: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 8 },
  smallText: { color: '#1a56db', fontWeight: '600' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: '#1a56db' },
  chipOn: { backgroundColor: '#1a56db' },
  chipOnText: { color: '#fff' },
  dim: { opacity: 0.5 },
  form: { gap: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, minHeight: 44 },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  outline: { flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: '#b91c1c', alignItems: 'center', justifyContent: 'center' },
  dangerOutlineText: { color: '#b91c1c', fontWeight: '600' },
  danger: { minHeight: 44, borderRadius: 22, backgroundColor: '#b91c1c', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: '#fff', fontWeight: '600' },
  confirm: { gap: 8 },
  error: { color: '#b91c1c' },
});
