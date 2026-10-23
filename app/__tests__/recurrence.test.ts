import i18next from 'i18next';

import { describeRecurrence, formatSessionDate } from '../src/features/activities/recurrence';
import en from '../src/i18n/locales/en.json';
import fr from '../src/i18n/locales/fr.json';

function tFor(lng: 'fr' | 'en') {
  const i = i18next.createInstance();
  void i.init({
    lng,
    resources: { fr: { translation: fr }, en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  return i.getFixedT(lng);
}

describe('describeRecurrence', () => {
  const frT = tFor('fr');
  const enT = tFor('en');
  const cases: [string, any, string, string][] = [
    ['weekly', { kind: 'weekly' }, 'Chaque semaine le mardi à 19:00', 'Every week on Tuesday at 19:00'],
    ['every n days', { kind: 'every_n_days', days: 3 }, 'Tous les 3 jours à 19:00', 'Every 3 days at 19:00'],
    ['two weekdays', { kind: 'weekdays', weekdays: [4, 1] }, 'Le lundi et le jeudi à 19:00', 'On Monday and Thursday at 19:00'],
    ['three weekdays', { kind: 'weekdays', weekdays: [1, 3, 7] }, 'Le lundi, le mercredi et le dimanche à 19:00', 'On Monday, Wednesday and Sunday at 19:00'],
    ['one weekday', { kind: 'weekdays', weekdays: [2] }, 'Le mardi à 19:00', 'On Tuesday at 19:00'],
  ];
  it.each(cases)('%s', (_n, r, f, e) => {
    const ctx = { startDate: '2026-10-27' };
    expect(describeRecurrence(r, '19:00:00', frT, ctx)).toBe(f);
    expect(describeRecurrence(r, '19:00', enT, ctx)).toBe(e);
  });
  it('weekly without a start date drops the weekday', () => {
    expect(describeRecurrence({ kind: 'weekly' }, '19:00', frT)).toBe('Chaque semaine à 19:00');
  });
  it('weekly with an empty weekdays array falls back to the start date weekday', () => {
    const r: any = { kind: 'weekly', weekdays: [] };
    expect(describeRecurrence(r, '19:00', frT, { startDate: '2026-10-27' })).toBe('Chaque semaine le mardi à 19:00');
    expect(describeRecurrence(r, '19:00', frT)).toBe('Chaque semaine à 19:00');
  });
  it('an empty weekdays rule never renders undefined', () => {
    const r: any = { kind: 'weekdays', weekdays: [] };
    expect(describeRecurrence(r, '19:00', frT, { startDate: '2026-10-27' })).toBe('Chaque semaine le mardi à 19:00');
    expect(describeRecurrence(r, '19:00', enT)).toBe('Every week at 19:00');
  });
  it('takes the language from t', () => {
    expect(describeRecurrence({ kind: 'weekly' }, '19:00', enT, { startDate: '2026-10-27' })).toBe(
      'Every week on Tuesday at 19:00',
    );
    expect(describeRecurrence({ kind: 'weekly' }, '19:00', frT, { startDate: '2026-10-27' })).toBe(
      'Chaque semaine le mardi à 19:00',
    );
  });
  it('exposes the short labels', () => {
    expect(frT('activities.recurrence.weekly')).toBe('Chaque semaine');
    expect(frT('activities.recurrence.everyNDays', { n: 4 })).toBe('Tous les 4 jours');
    expect(frT('activities.recurrence.weekdays')).toBe('Certains jours');
  });
});

describe('formatSessionDate', () => {
  it('formats in Paris time', () => {
    expect(formatSessionDate('2026-10-27T18:00:00Z', 'fr')).toBe('mardi 27 octobre, 19:00');
    expect(formatSessionDate('2026-10-27T18:00:00Z', 'en')).toBe('Tuesday 27 October, 19:00');
  });
  it('keeps 19:00 wall time across the 2026-10-25 DST change', () => {
    expect(formatSessionDate('2026-10-24T17:00:00Z', 'fr')).toBe('samedi 24 octobre, 19:00'); // CEST +2
    expect(formatSessionDate('2026-10-26T18:00:00Z', 'fr')).toBe('lundi 26 octobre, 19:00'); // CET +1
    expect(formatSessionDate('2026-10-26T17:00:00Z', 'fr')).toBe('lundi 26 octobre, 18:00');
  });
  it('does not depend on the device zone near midnight', () => {
    expect(formatSessionDate('2026-10-27T22:30:00Z', 'en')).toBe('Tuesday 27 October, 23:30');
    expect(formatSessionDate('2026-10-27T23:30:00Z', 'en')).toBe('Wednesday 28 October, 00:30');
  });
});
