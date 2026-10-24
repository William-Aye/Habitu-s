import type { ActivityPage, SessionInfo } from './types';

/** The web calendar file is fixed at two hours, whatever the activity's planned length. */
const DURATION_MS = 2 * 3600_000;
const MAX_OCTETS = 75;

/** RFC 5545 text escaping: backslash first, then separators and line breaks. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** 20260714T173000Z */
function utc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function octets(char: string): number {
  const c = char.codePointAt(0) ?? 0;
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

/** Content lines are folded at 75 octets; a continuation starts with one space (counted too). */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > MAX_OCTETS) {
      parts.push(current);
      current = ' ';
      size = 1;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** An iCalendar file with one event, in UTC, ending two hours after it starts. */
export function buildIcs(
  session: Pick<SessionInfo, 'id' | 'startsAt' | 'placeLabel'>,
  activity: Pick<ActivityPage, 'title'>,
  publicUrl: string,
  now: Date = new Date(),
): string {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + DURATION_MS);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Habitues//Public web//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${session.id}@habitues`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escapeText(activity.title)}`,
    `LOCATION:${escapeText(session.placeLabel)}`,
    `URL:${publicUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
