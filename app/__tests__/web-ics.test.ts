import { buildIcs } from '../src/features/activities/ics';

const NOW = new Date('2026-07-01T08:00:00Z');
const activity = { id: 'act1', title: 'Jeux, cartes; et plus\nce soir' };

it('writes the start and the end (2 h) in UTC for a summer (DST) Paris date', () => {
  const ics = buildIcs(
    { id: 's1', startsAt: '2026-07-14T19:30:00+02:00', placeLabel: 'Café des Arts, Lyon' },
    activity,
    'https://habitues.example/activites/jeux-act1',
    NOW,
  );
  expect(ics).toBe(
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Habitues//Public web//FR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:s1@habitues',
      'DTSTAMP:20260701T080000Z',
      'DTSTART:20260714T173000Z',
      'DTEND:20260714T193000Z',
      'SUMMARY:Jeux\\, cartes\\; et plus\\nce soir',
      'LOCATION:Café des Arts\\, Lyon',
      'URL:https://habitues.example/activites/jeux-act1',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n'),
  );
});

it('uses the winter offset after the clocks change back', () => {
  const ics = buildIcs(
    { id: 's2', startsAt: '2026-12-01T19:00:00+01:00', placeLabel: 'Parc' },
    { title: 'Marche' },
    'https://x.example/a',
    NOW,
  );
  expect(ics).toContain('DTSTART:20261201T180000Z\r\n');
  expect(ics).toContain('DTEND:20261201T200000Z\r\n');
});

it('crosses midnight and escapes backslashes', () => {
  const ics = buildIcs(
    { id: 's3', startsAt: '2026-03-28T23:00:00Z', placeLabel: 'Rue\\X' },
    { title: 'T' },
    'https://x.example/a',
    NOW,
  );
  expect(ics).toContain('DTEND:20260329T010000Z\r\n');
  expect(ics).toContain('LOCATION:Rue\\\\X\r\n');
});

it('folds lines longer than 75 octets', () => {
  const ics = buildIcs(
    { id: 's4', startsAt: '2026-03-28T23:00:00Z', placeLabel: 'é'.repeat(80) },
    { title: 'T' },
    'https://x.example/a',
    NOW,
  );
  const lines = ics.split('\r\n');
  const enc = new TextEncoder();
  for (const l of lines) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
  expect(ics.replace(/\r\n /g, '')).toContain(`LOCATION:${'é'.repeat(80)}`);
});
