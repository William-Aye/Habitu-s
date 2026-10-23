import { wallTime } from '../activities/time';

/** "19:05" for today, "23/10 19:05" otherwise, always Europe/Paris (same zone handling as formatSessionDate). */
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const at = wallTime(iso, 'Europe/Paris');
  const today = wallTime(now.toISOString(), 'Europe/Paris').date;
  if (at.date === today) return at.time;
  const [, month, day] = at.date.split('-');
  return `${day}/${month} ${at.time}`;
}
