import i18n, { t } from 'i18next';
import { Share } from 'react-native';
import { wallTime } from '../activities/time';
import type { ActivityPage, SessionInfo } from '../activities/types';

const LOCALE = { fr: 'fr-FR', en: 'en-GB' } as const;

/** Opens the system share sheet with where and when I will be, Paris time. */
export async function shareMyPlans(
  session: SessionInfo,
  activity: Pick<ActivityPage, 'title' | 'placeLabel'>,
): Promise<'shared' | 'dismissed'> {
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const date = new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(session.startsAt));
  const message = t('safety.shareMessage', {
    titre: activity.title,
    date,
    heure: wallTime(session.startsAt, 'Europe/Paris').time,
    lieu: session.placeLabel || activity.placeLabel,
    interpolation: { escapeValue: false },
  });
  const r = await Share.share({ message });
  return r.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
