import { initialForm, localDate, stepValid } from '../src/features/activities/form';

describe('dates are computed in Europe/Paris', () => {
  it('uses the Paris day when the device is still on the previous day', () => {
    // 23:30 UTC on 14 May is 01:30 on 15 May in Paris (summer time).
    const now = new Date('2030-05-14T23:30:00Z');
    expect(localDate(now)).toBe('2030-05-15');
    expect(initialForm(null, now).startDate).toBe('2030-05-16');
  });

  it('keeps the same day just before Paris midnight', () => {
    const now = new Date('2030-05-14T21:30:00Z'); // 23:30 in Paris
    expect(localDate(now)).toBe('2030-05-14');
    expect(initialForm(null, now).startDate).toBe('2030-05-15');
  });

  it('follows winter time and accepts today but not yesterday', () => {
    const now = new Date('2030-01-14T23:30:00Z'); // 00:30 on 15 January in Paris
    expect(localDate(now)).toBe('2030-01-15');
    const form = { ...initialForm(null, now), categoryId: 'c', title: 'abc', pin: { lon: 1, lat: 1 }, placeLabel: 'x' };
    expect(stepValid(3, { ...form, startDate: '2030-01-15' }, localDate(now))).toBe(true);
    expect(stepValid(3, { ...form, startDate: '2030-01-14' }, localDate(now))).toBe(false);
  });
});
