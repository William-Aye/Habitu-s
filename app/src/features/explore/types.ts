export type Radius = 5 | 10 | 25 | 50;
export type ExploreKind = 'activity' | 'association';
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ExploreParams {
  query: string;
  center: { lon: number; lat: number };
  radiusKm: Radius;
  kinds: ExploreKind[];
  weekday: Weekday | null;
  newcomerFriendly: boolean;
  interestCategoryIds: string[];
  discoveryOnly: boolean;
  sort: 'best' | 'nearest';
}

/** A result is an activity, an association or a collectif (returned with associations). */
export type ResultKind = ExploreKind | 'collectif';

export interface ExploreResult {
  kind: ResultKind;
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  lon: number;
  lat: number;
  distanceKm: number;
  score: number;
  label: 'very_relevant' | 'relevant' | 'weak' | null;
  isWeak: boolean;
  isNew: boolean;
  sourceLabel: 'community' | 'unverified' | null;
  tagSlugs: string[];
}

export interface ExploreResponse {
  mode: 'search' | 'keyword_only' | 'browse';
  results: ExploreResult[];
  strongCount: number;
  strongCount50km: number;
  suggestRadiusKm: 50 | null;
  hasMore: boolean;
}

export interface AssociationDetail {
  id: string;
  name: string;
  purpose: string | null;
  city: string | null;
  postcode: string | null;
  lon: number | null;
  lat: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  openingHours: string | null;
  source: string;
  verified: boolean;
  claimed: boolean;
  sourceLabel: 'community' | 'unverified' | null;
  attributionKeys: string[];
  tags: { slug: string; labelFr: string; labelEn: string }[];
  activities: { id: string; title: string }[];
  canWait: boolean;
  isWaiting: boolean;
}

export interface Town {
  label: string;
  lon: number;
  lat: number;
}

export interface StoredLocation {
  label: string;
  lon: number;
  lat: number;
  source: 'gps' | 'town';
}

// Debounce key. Source of truth: the shared cases in shared/normalise_cases.json (keep identical in SQL, Python and the app).
const MAX_QUERY_CHARS = 200;
const WS = /[ \t\n\r\f\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

export function normaliseQuery(text: string): string {
  const collapsed = text.normalize('NFC').replace(WS, ' ').replace(/^ | $/g, '');
  return Array.from(collapsed.toLowerCase()).slice(0, MAX_QUERY_CHARS).join('');
}
