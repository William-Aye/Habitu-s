import { resolveInitialLanguage, shouldOfferLanguageChoice } from '../src/i18n';

describe('resolveInitialLanguage', () => {
  it.each([
    [null, 'en-GB', 'fr'], [null, 'en_US', 'fr'], [null, 'EN', 'fr'], [null, 'de-DE', 'fr'],
    [null, 'fr-CA', 'fr'], [null, '', 'fr'], [null, null, 'fr'],
    ['en', 'fr-FR', 'en'], ['fr', 'en-GB', 'fr'], ['xx', 'en-GB', 'fr'],
  ])('stored=%p device=%p -> %p', (stored, device, expected) => {
    expect(resolveInitialLanguage(stored, device)).toBe(expected);
  });
});

describe('shouldOfferLanguageChoice', () => {
  it.each([
    [null, 'en-GB', true], [null, 'en_US', true], [null, 'EN', true],
    [null, 'fr-FR', false], [null, 'de-DE', false], [null, null, false], [null, '', false],
    ['fr', 'en-GB', false], ['en', 'en-GB', false],
  ])('stored=%p device=%p -> %p', (stored, device, expected) => {
    expect(shouldOfferLanguageChoice(stored, device)).toBe(expected);
  });
});
