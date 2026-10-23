import type { ActivityDraft, ChatHistory, OrganisedByChoice, Recurrence } from './types';

export const STEP_COUNT = 5;
export const TITLE_MIN = 3;
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 2000;
export const PLACE_LABEL_MAX = 120;
export const MAX_SIZE_MIN = 2;
export const MAX_SIZE_MAX = 200;
export const DAYS_MIN = 2;
export const DAYS_MAX = 60;

export interface FormState {
  who: 'me' | 'collectif' | 'association';
  collectifId: string | null;
  association: { id: string; name: string } | null;
  categoryId: string | null;
  title: string;
  description: string;
  pin: { lon: number; lat: number } | null;
  townLabel: string;
  placeLabel: string;
  startDate: string;
  startTime: string;
  recurrenceKind: Recurrence['kind'];
  everyDays: string;
  weekdays: number[];
  maxSize: string;
  newcomerFriendly: boolean;
  approvalMode: 'open' | 'approval';
  chatHistory: ChatHistory;
}

const PARIS_DAY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in Europe/Paris (where sessions are scheduled) as YYYY-MM-DD, whatever the device zone. */
export function localDate(d: Date): string {
  const part = (type: string) => PARIS_DAY.formatToParts(d).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function initialForm(collectifId?: string | null, now = new Date()): FormState {
  return {
    who: collectifId ? 'collectif' : 'me',
    collectifId: collectifId ?? null,
    association: null,
    categoryId: null,
    title: '',
    description: '',
    pin: null,
    townLabel: '',
    placeLabel: '',
    startDate: nextDay(localDate(now)),
    startTime: '19:00',
    recurrenceKind: 'weekly',
    everyDays: '7',
    weekdays: [],
    maxSize: '',
    newcomerFriendly: false,
    approvalMode: 'open',
    chatHistory: 'all',
  };
}

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export const isValidTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Whole number inside [min, max], or null when the text is not one. */
function parseInt10(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Empty means no limit; otherwise 2 to 200. Returns undefined when invalid. */
export function parseMaxSize(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  return parseInt10(text, MAX_SIZE_MIN, MAX_SIZE_MAX) ?? undefined;
}

export function recurrenceOf(f: FormState): Recurrence | null {
  if (f.recurrenceKind === 'weekly') return { kind: 'weekly' };
  if (f.recurrenceKind === 'every_n_days') {
    const days = parseInt10(f.everyDays, DAYS_MIN, DAYS_MAX);
    return days === null ? null : { kind: 'every_n_days', days };
  }
  return f.weekdays.length === 0 ? null : { kind: 'weekdays', weekdays: [...f.weekdays].sort((a, b) => a - b) };
}

function organisedByOf(f: FormState): OrganisedByChoice | null {
  if (f.who === 'me') return { kind: 'me' };
  if (f.who === 'collectif') return f.collectifId ? { kind: 'collectif', id: f.collectifId } : null;
  return f.association ? { kind: 'association', id: f.association.id } : null;
}

/** Whether the step (0-based) holds everything it needs. `today` is a local YYYY-MM-DD. */
export function stepValid(step: number, f: FormState, today = localDate(new Date())): boolean {
  switch (step) {
    case 0:
      return organisedByOf(f) !== null;
    case 1: {
      const title = f.title.trim().length;
      return f.categoryId !== null && title >= TITLE_MIN && title <= TITLE_MAX && f.description.length <= DESCRIPTION_MAX;
    }
    case 2:
      return f.pin !== null && f.placeLabel.trim().length > 0 && f.placeLabel.length <= PLACE_LABEL_MAX;
    case 3:
      return (
        isRealDate(f.startDate) && f.startDate >= today && isValidTime(f.startTime) && recurrenceOf(f) !== null
      );
    default:
      return parseMaxSize(f.maxSize) !== undefined;
  }
}

/** The draft to publish, or null while any step is invalid. */
export function toDraft(f: FormState, today?: string): ActivityDraft | null {
  const organisedBy = organisedByOf(f);
  const recurrence = recurrenceOf(f);
  const maxSize = parseMaxSize(f.maxSize);
  if (
    !organisedBy || !recurrence || maxSize === undefined || !f.categoryId || !f.pin ||
    ![0, 1, 2, 3, 4].every((s) => stepValid(s, f, today))
  ) {
    return null;
  }
  return {
    organisedBy,
    categoryId: f.categoryId,
    title: f.title.trim(),
    description: f.description.trim(),
    place: { label: f.placeLabel.trim(), lon: f.pin.lon, lat: f.pin.lat },
    startDate: f.startDate,
    startTime: f.startTime,
    recurrence,
    maxSize,
    newcomerFriendly: f.newcomerFriendly,
    approvalMode: f.approvalMode,
    chatHistory: f.chatHistory,
  };
}
