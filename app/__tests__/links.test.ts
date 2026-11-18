import fs from 'fs';
import path from 'path';
import { activityUrl, associationUrl, idFromLink, slugify } from '../src/lib/links';

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../web/src/slug_fixtures.json'), 'utf8'),
);
const ID = '123e4567-e89b-12d3-a456-426614174000';

describe('slugify (same fixtures as the Worker)', () => {
  it('matches every fixture', () => {
    for (const c of fixtures.slugify as { input: string; slug: string }[]) expect(slugify(c.input)).toBe(c.slug);
  });
  it('caps at 60 characters without a trailing dash', () => {
    const s = slugify(fixtures.slugifyMax60.input);
    expect(s).toBe(fixtures.slugifyMax60.slug);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('url builders', () => {
  const OLD = process.env.EXPO_PUBLIC_WEB_BASE_URL;
  afterEach(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = OLD;
  });
  it('builds readable addresses', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habituer.example/';
    expect(activityUrl(ID, 'Jeu de go — le Mardi')).toBe(`https://habituer.example/activites/jeu-de-go-le-mardi-${ID}`);
    expect(associationUrl(ID, 'Les Échecs', 'Lyon')).toBe(`https://habituer.example/associations/les-echecs-lyon-${ID}`);
    expect(associationUrl(ID, 'Les Échecs', null)).toBe(`https://habituer.example/associations/les-echecs-${ID}`);
  });
  it('omits the slug when the title has no Latin letters', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://habituer.example';
    expect(activityUrl(ID, '日本語')).toBe(`https://habituer.example/activites/${ID}`);
  });
  it('falls back to the app link without a base', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = '';
    expect(activityUrl(ID, 'Go')).toBe(`habituer://activites/${ID}`);
    expect(associationUrl(ID, 'Asso', 'Lyon')).toBe(`habituer://associations/${ID}`);
  });
});

describe('idFromLink', () => {
  it.each([
    [`https://habituer.example/activites/jeu-${ID}`, 'activity'],
    [`https://habituer.example/activites/${ID}?utm=1`, 'activity'],
    [`https://habituer.example/app/activites/${ID}`, 'activity'],
    [`habituer://activites/${ID}`, 'activity'],
    [`/activites/jeu-${ID}`, 'activity'],
    [`/app/activites/${ID}`, 'activity'],
    [`https://habituer.example/associations/club-lyon-${ID}`, 'association'],
    [`habituer://associations/${ID}`, 'association'],
    [`/app/associations/${ID}#x`, 'association'],
  ])('%s', (url, kind) => {
    expect(idFromLink(url)).toEqual({ kind, id: ID });
  });
  it('lower-cases the id', () => {
    expect(idFromLink(`/activites/${ID.toUpperCase()}`)).toEqual({ kind: 'activity', id: ID });
  });
  it.each(['', 'garbage', `https://x.example/explore/${ID}`, '/activites/new', '/activites/jeu-123e4567', `/activites/jeuxx${ID}`])(
    'returns null for %p',
    (url) => {
      expect(idFromLink(url)).toBeNull();
    },
  );
});
