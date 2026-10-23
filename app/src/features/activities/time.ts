/** Wall-clock time of an instant in a time zone, as { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function wallTime(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** The instant (ISO, UTC) at which the wall clock of `timeZone` shows `date` `time`. */
export function instantOf(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const target = Date.UTC(y, m - 1, d, hh, mm);
  let guess = target;
  // Two passes settle the offset, also across a clock change.
  for (let i = 0; i < 2; i++) {
    const w = wallTime(new Date(guess).toISOString(), timeZone);
    const [wy, wm, wd] = w.date.split('-').map(Number);
    const [wh, wmin] = w.time.split(':').map(Number);
    guess += target - Date.UTC(wy, wm - 1, wd, wh, wmin);
  }
  return new Date(guess).toISOString();
}
