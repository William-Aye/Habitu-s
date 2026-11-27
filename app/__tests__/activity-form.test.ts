import { initialForm, isFamilyCategory, localDate, stepValid, toDraft } from '../src/features/activities/form';

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

describe('activities with children', () => {
  const cats = [
    { id: 'fam', slug: 'family', parentId: null },
    { id: 'kids', slug: 'family-sorties-parents-enfants', parentId: 'fam' },
    { id: 'sport', slug: 'sport', parentId: null },
    { id: 'yoga', slug: 'yoga', parentId: 'sport' },
  ];

  it('knows the Parents category and its sub-categories', () => {
    expect(isFamilyCategory('fam', cats)).toBe(true);
    expect(isFamilyCategory('kids', cats)).toBe(true);
  });

  it('is false for other categories and for an unknown id', () => {
    expect(isFamilyCategory('sport', cats)).toBe(false);
    expect(isFamilyCategory('yoga', cats)).toBe(false);
    expect(isFamilyCategory('nope', cats)).toBe(false);
  });

  const now = new Date('2030-05-10T10:00:00Z');
  const ready = {
    ...initialForm(null, now), categoryId: 'c', title: 'Sortie au parc', pin: { lon: 1, lat: 1 }, placeLabel: 'Square',
  };

  it('starts with no children and no Parents category', () => {
    expect(initialForm(null, now)).toMatchObject({ withChildren: false, familyCategory: false });
  });

  it('sends the flag and forces approval when children will be there', () => {
    expect(toDraft({ ...ready, withChildren: true, approvalMode: 'open' }, localDate(now))).toMatchObject({
      withChildren: true, approvalMode: 'approval',
    });
    expect(toDraft({ ...ready, familyCategory: true, approvalMode: 'open' }, localDate(now))).toMatchObject({
      withChildren: true, approvalMode: 'approval',
    });
    expect(toDraft({ ...ready, approvalMode: 'open' }, localDate(now))).toMatchObject({
      withChildren: false, approvalMode: 'open',
    });
  });
});
