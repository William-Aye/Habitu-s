import fr from '../src/i18n/locales/fr.json';
import en from '../src/i18n/locales/en.json';

const keys = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
const values = (o: object): string[] =>
  Object.values(o).flatMap((v) => (typeof v === 'object' ? values(v) : [String(v)]));

it('every French key has an English equivalent and vice versa', () => {
  expect(keys(en).sort()).toEqual(keys(fr).sort());
});
it('no empty translations', () => {
  expect([...values(fr), ...values(en)].filter((v) => v.trim() === '')).toEqual([]);
});
it('no emoji in any translation', () => {
  expect([...values(fr), ...values(en)].filter((v) => /\p{Extended_Pictographic}/u.test(v.replace(/©/g, '')))).toEqual([]);
});
