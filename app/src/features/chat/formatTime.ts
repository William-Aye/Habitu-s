import { wallTime } from '../activities/time';

/** The day before a "YYYY-MM-DD" date. */
function previousDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Message date for lists, in Europe/Paris: "19:05" today, `yesterday` the day before, "23/10" earlier this
 * year, "23/10/2025" before that. `yesterday` is the translated word, so this stays language-neutral.
 */
export function formatMessageTime(iso: string, now: Date = new Date(), yesterday = 'hier'): string {
  const at = wallTime(iso, 'Europe/Paris');
  const today = wallTime(now.toISOString(), 'Europe/Paris').date;
  if (at.date === today) return at.time;
  if (at.date === previousDay(today)) return yesterday;
  const [year, month, day] = at.date.split('-');
  return year === today.slice(0, 4) ? `${day}/${month}` : `${day}/${month}/${year}`;
}
