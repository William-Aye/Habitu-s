import cases from '../../supabase/functions/embed-query/normalise_cases.json';
import { normaliseQuery } from '../src/features/explore/types';

describe('normaliseQuery shared fixture', () => {
  it.each(cases as { input: string; expected: string }[])(
    'normalises case %#',
    ({ input, expected }) => {
      expect(normaliseQuery(input)).toBe(expected);
    },
  );
});
