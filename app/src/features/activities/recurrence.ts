import type { TFunction } from 'i18next';

import type { Recurrence } from './types';

type Lang = 'fr' | 'en';

const LOCALE: Record<Lang, string> = { fr: 'fr-FR', en: 'en-GB' };

/** ISO weekday (1 = Monday ... 7 = Sunday) name in the language. */
function weekdayName(isoDay: number, lang: Lang): string {
  // 2024-01-01 is a Monday.
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, isoDay)),
  );
}

function isoWeekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Chaque semaine le mardi à 19:00", "Tous les 3 jours à 19:00", "Le lundi et le jeudi à 19:00".
 * A weekly recurrence runs on the weekday of the start date, so pass `startDate` to name it.
 */
export function describeRecurrence(
  r: Recurrence,
  startTime: string,
  t: TFunction,
  ctx: { startDate?: string; lang?: Lang } = {},
): string {
  const lang: Lang = ctx.lang ?? (String((t as { lng?: string }).lng ?? 'fr').startsWith('en') ? 'en' : 'fr');
  const time = startTime.slice(0, 5);
  if (r.kind === 'every_n_days') {
    return t('activities.recurrence.atTime', {
      label: t('activities.recurrence.everyNDays', { n: r.days }),
      time,
    });
  }
  const weekdays = r.kind === 'weekdays' ? r.weekdays : [];
  if (r.kind === 'weekly' || weekdays.length === 0) {
    const label = t('activities.recurrence.weekly');
    if (!ctx.startDate) return t('activities.recurrence.atTime', { label, time });
    return t('activities.recurrence.weeklyOn', {
      label,
      day: weekdayName(isoWeekdayOf(ctx.startDate), lang),
      time,
    });
  }
  const names = [...r.weekdays]
    .sort((a, b) => a - b)
    .map((d) => t('activities.recurrence.dayItem', { day: weekdayName(d, lang) }));
  const days =
    names.length > 1
      ? t('activities.recurrence.list', {
          head: names.slice(0, -1).join(', '),
          last: names[names.length - 1],
        })
      : names[0];
  return capitalise(t('activities.recurrence.onDays', { days, time }));
}

/** "mardi 27 octobre, 19:00" / "Tuesday 27 October, 19:00", always Europe/Paris. */
export function formatSessionDate(iso: string, lang: Lang): string {
  const parts = new Intl.DateTimeFormat(LOCALE[lang], {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')}`;
}
