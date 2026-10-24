import { redirectSystemPath } from '../src/app/+native-intent';

const ID = '123e4567-e89b-12d3-a456-426614174000';

describe('redirectSystemPath', () => {
  it('maps slug links to the id route', () => {
    expect(redirectSystemPath({ path: `https://habitues.example/activites/jeu-de-go-${ID}`, initial: true })).toBe(`/activites/${ID}`);
    expect(redirectSystemPath({ path: `https://habitues.example/associations/club-lyon-${ID}`, initial: false })).toBe(`/associations/${ID}`);
    expect(redirectSystemPath({ path: `friendapp://activites/${ID}`, initial: true })).toBe(`/activites/${ID}`);
  });
  it('leaves other paths alone', () => {
    expect(redirectSystemPath({ path: '/explore', initial: false })).toBe('/explore');
    expect(redirectSystemPath({ path: 'friendapp://activites/new', initial: false })).toBe('friendapp://activites/new');
  });
});
