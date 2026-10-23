export type Recurrence =
  | { kind: 'weekly' }
  | { kind: 'every_n_days'; days: number }
  | { kind: 'weekdays'; weekdays: number[] };

export type OrganisedByChoice =
  | { kind: 'me' }
  | { kind: 'collectif'; id: string }
  | { kind: 'association'; id: string };

export interface ActivityDraft {
  organisedBy: OrganisedByChoice;
  categoryId: string;
  title: string;
  description: string;
  place: { label: string; lon: number; lat: number };
  startDate: string;
  startTime: string;
  recurrence: Recurrence;
  maxSize: number | null;
  newcomerFriendly: boolean;
  approvalMode: 'open' | 'approval';
}

export type ApiError = 'limit_reached' | 'not_allowed' | 'session_full' | 'network' | 'unknown';
export type ApiResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: ApiError };

export type AttendanceStatus = 'confirmed' | 'cancelled' | 'cancelled_late' | 'no_show';
export type SessionStatus = 'scheduled' | 'held' | 'cancelled_by_organiser' | 'cancelled_min_not_reached';
export type MyStatus = 'none' | 'member' | 'pending';

export interface PersonInfo {
  firstName: string;
  photoUrl: string | null;
}

export interface SessionInfo {
  id: string;
  startsAt: string;
  placeLabel: string;
  isDiscovery: boolean;
  status: SessionStatus;
  confirmedCount: number;
  isFull: boolean;
  myAttendance: { status: AttendanceStatus; guestCount: number } | null;
  /** Present only for members and the organiser. */
  attendees?: PersonInfo[];
}

export interface ActivityPage {
  id: string;
  title: string;
  description: string | null;
  category: { id: string; slug: string; nameFr: string; nameEn: string; icon: string } | null;
  tags: { slug: string; labelFr: string; labelEn: string }[];
  organiser: PersonInfo | null;
  organisedBy: { kind: 'association' | 'collectif'; id: string; name: string } | null;
  placeLabel: string;
  lon: number;
  lat: number;
  recurrence: Recurrence;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  timezone: string;
  maxSize: number | null;
  newcomerFriendly: boolean;
  approvalMode: 'open' | 'approval';
  publishedAt: string;
  archivedAt: string | null;
  isOrganiser: boolean;
  myStatus: MyStatus;
  nextSessions: SessionInfo[];
  /** Present only for members and the organiser. */
  welcomeFirstName?: string | null;
}

export interface MyActivity {
  id: string;
  title: string;
  placeLabel: string;
  categoryIcon: string;
  isOrganiser: boolean;
  myStatus: MyStatus;
  nextSession: SessionInfo | null;
}

export interface CollectifPage {
  id: string;
  name: string;
  description: string | null;
  townLabel: string;
  lon: number;
  lat: number;
  organisers: { firstName: string; photoUrl: string | null; role: 'responsable' | 'organiser' }[];
  activities: { id: string; title: string; nextStartsAt: string | null }[];
  myRole: 'responsable' | 'organiser' | null;
}

export interface MyCollectif {
  id: string;
  name: string;
  townLabel: string;
  role: 'responsable' | 'organiser';
}

export interface SessionPatch {
  startsAt?: string;
  placeLabel?: string;
  place?: { lon: number; lat: number };
  isDiscovery?: boolean;
  status?: 'cancelled_by_organiser';
}
