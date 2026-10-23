import { CalendarPlus, Check, Square, SquareCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SessionTools } from './OrganiserTools';
import { PersonAvatar } from './PersonAvatar';
import { setAttendance } from './api';
import { askForPush } from '../notifications/registerPush';
import { addSessionToCalendar } from './calendar';
import { formatSessionDate } from './recurrence';
import type { ActivityPage, ApiError, SessionInfo } from './types';

const KNOWN: ApiError[] = ['limit_reached', 'not_allowed', 'session_full', 'network', 'association_unavailable'];

interface Props {
  session: SessionInfo;
  activity: ActivityPage;
  /** Show "À votre arrivée, demandez ..." on this session. */
  showWelcome: boolean;
  /** Re-reads the activity page. */
  onChanged: () => void;
}

export function SessionRow({ session, activity, showWelcome, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const [knownFull, setKnownFull] = useState(false);

  const date = formatSessionDate(session.startsAt, lang);
  const cancelled = session.status !== 'scheduled';
  const canAttend = activity.myStatus === 'member' || activity.isOrganiser;
  const mine = session.myAttendance;
  const isConfirmed = mine?.status === 'confirmed';
  const guest = (mine?.guestCount ?? 0) === 1;
  const full = (session.isFull || knownFull) && !isConfirmed;

  const attend = async (status: 'confirmed' | 'cancelled', guestCount: 0 | 1) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await setAttendance(session.id, status, guestCount);
    setBusy(false);
    if (!r.ok) {
      if (r.error === 'session_full') setKnownFull(true);
      setError(t(`create.errors.${KNOWN.includes(r.error) ? r.error : 'unknown'}`));
      return;
    }
    setKnownFull(false);
    if (status === 'confirmed') void askForPush();
    onChanged();
  };

  const addToCalendar = async () => {
    setCalendarMsg(null);
    const result = await addSessionToCalendar(session, activity);
    if (result === 'unavailable') setCalendarMsg(t('activity.session.calendarUnavailable'));
  };

  return (
    <View style={styles.row}>
      <View style={styles.wrap}>
        <Text style={styles.date}>{date}</Text>
        {session.isDiscovery ? <Text style={styles.badge}>{t('activity.session.discovery')}</Text> : null}
        {cancelled ? <Text style={styles.badgeWarn}>{t('activity.session.cancelled')}</Text> : null}
        {full && !cancelled ? <Text style={styles.badgeWarn}>{t('activity.session.full')}</Text> : null}
      </View>
      <Text>{session.placeLabel}</Text>
      <Text>{t('activity.session.count', { count: session.confirmedCount })}</Text>

      {session.attendees && session.attendees.length > 0 ? (
        <View style={styles.wrap} accessibilityLabel={t('activity.session.attendees')}>
          {session.attendees.map((p, i) => (
            <View key={`${p.firstName}-${i}`} style={styles.person}>
              <PersonAvatar name={p.firstName} photoUrl={p.photoUrl} size={28} />
              <Text>{p.firstName}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!cancelled && canAttend ? (
        <View style={styles.actions}>
          {isConfirmed ? (
            <>
              <View style={styles.wrap}>
                <Check size={18} color="#047857" />
                <Text style={styles.confirmed}>{t('activity.session.confirmed')}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('activity.session.cancelAria', { date })}
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  style={[styles.link, busy && styles.dim]}
                  onPress={() => attend('cancelled', 0)}
                >
                  <Text style={styles.linkText}>{t('activity.session.cancel')}</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={t('activity.session.guestAria', { date })}
                accessibilityState={{ checked: guest, disabled: busy }}
                disabled={busy}
                style={[styles.link, busy && styles.dim]}
                onPress={() => attend('confirmed', guest ? 0 : 1)}
              >
                {guest ? <SquareCheck size={18} color="#1a56db" /> : <Square size={18} color="#1a56db" />}
                <Text style={styles.linkText}>{t('activity.session.guest')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('activity.session.calendarAria', { date })}
                style={styles.link}
                onPress={addToCalendar}
              >
                <CalendarPlus size={18} color="#1a56db" />
                <Text style={styles.linkText}>{t('activity.session.addToCalendar')}</Text>
              </Pressable>
              {showWelcome && activity.welcomeFirstName ? (
                <Text>{t('activity.session.welcomeHint', { prenom: activity.welcomeFirstName })}</Text>
              ) : null}
            </>
          ) : !full ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('activity.session.confirmAria', { date })}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              style={[styles.primary, busy && styles.dim]}
              onPress={() => attend('confirmed', 0)}
            >
              <Text style={styles.primaryText}>{t('activity.session.imThere')}</Text>
            </Pressable>
          ) : null}
          {mine?.status === 'cancelled_late' ? (
            <Text accessibilityLiveRegion="polite">{t('activity.session.lateCancel')}</Text>
          ) : mine?.status === 'cancelled' ? (
            <Text>{t('activity.session.youCancelled')}</Text>
          ) : null}
        </View>
      ) : null}

      {calendarMsg ? <Text accessibilityLiveRegion="polite">{calendarMsg}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

      {activity.isOrganiser && !cancelled && !activity.archivedAt ? (
        <SessionTools session={session} activity={activity} onChanged={onChanged} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, padding: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  date: { fontWeight: '600', fontSize: 16 },
  badge: { backgroundColor: '#eef2ff', color: '#1a3a9e', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, overflow: 'hidden' },
  badgeWarn: { backgroundColor: '#fef2f2', color: '#b91c1c', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12, overflow: 'hidden' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { gap: 4 },
  confirmed: { color: '#047857', fontWeight: '600' },
  primary: { minHeight: 48, borderRadius: 24, backgroundColor: '#1a56db', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { color: '#1a56db', fontWeight: '600' },
  dim: { opacity: 0.5 },
  error: { color: '#b91c1c' },
});
