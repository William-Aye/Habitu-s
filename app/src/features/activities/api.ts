import { supabase } from '../../lib/supabase';
import { run, runAsUser, toPoint } from './errors';
import type {
  ActivityDraft,
  ActivityPage,
  ApiResult,
  MyActivity,
  MyStatus,
  Recurrence,
  SessionInfo,
  SessionPatch,
} from './types';

export type { ApiError, ApiResult } from './types';

const none = () => ({});

function mapPerson(p: any) {
  return { firstName: p.first_name as string, photoUrl: (p.photo_url ?? null) as string | null };
}

export function mapSession(s: any): SessionInfo {
  return {
    id: s.id,
    startsAt: s.starts_at,
    placeLabel: s.place_label,
    isDiscovery: !!s.is_discovery,
    status: s.status,
    confirmedCount: s.confirmed_count ?? 0,
    isFull: !!s.is_full,
    myAttendance: s.my_attendance
      ? { status: s.my_attendance.status, guestCount: s.my_attendance.guest_count }
      : null,
    ...(s.attendees ? { attendees: s.attendees.map(mapPerson) } : {}),
  };
}

function mapRecurrence(a: any): Recurrence {
  if (a.recurrence_kind === 'every_n_days') {
    return { kind: 'every_n_days', days: a.recurrence_interval_days };
  }
  if (a.recurrence_kind === 'weekdays') {
    return { kind: 'weekdays', weekdays: a.recurrence_weekdays ?? [] };
  }
  return { kind: 'weekly' };
}

function mapActivity(a: any): ActivityPage {
  return {
    id: a.id,
    title: a.title,
    description: a.description ?? null,
    category: a.category
      ? {
          id: a.category.id,
          slug: a.category.slug,
          nameFr: a.category.name_fr,
          nameEn: a.category.name_en,
          icon: a.category.icon,
        }
      : null,
    tags: (a.tags ?? []).map((t: any) => ({ slug: t.slug, labelFr: t.label_fr, labelEn: t.label_en })),
    organiser: a.organiser ? mapPerson(a.organiser) : null,
    organisedBy: a.organised_by
      ? { kind: a.organised_by.kind, id: a.organised_by.id, name: a.organised_by.name }
      : null,
    placeLabel: a.place_label,
    lon: a.lon,
    lat: a.lat,
    recurrence: mapRecurrence(a),
    startDate: a.start_date,
    startTime: a.start_time,
    durationMinutes: a.duration_minutes,
    timezone: a.timezone,
    maxSize: a.max_size ?? null,
    newcomerFriendly: !!a.newcomer_friendly,
    approvalMode: a.approval_mode,
    publishedAt: a.published_at,
    archivedAt: a.archived_at ?? null,
    isOrganiser: !!a.is_organiser,
    myStatus: a.my_status,
    nextSessions: (a.next_sessions ?? []).map(mapSession),
    ...('welcome_first_name' in a ? { welcomeFirstName: a.welcome_first_name ?? null } : {}),
    ...(typeof a.my_past_attendance_count === 'number'
      ? { myPastAttendanceCount: a.my_past_attendance_count as number }
      : {}),
  };
}

export function createActivity(d: ActivityDraft): Promise<ApiResult<{ id: string }>> {
  const r = d.recurrence;
  if (r.kind === 'every_n_days' && !(Number.isInteger(r.days) && r.days >= 2 && r.days <= 60)) {
    return Promise.resolve({ ok: false, error: 'unknown' });
  }
  return runAsUser(
    (userId) =>
      supabase
        .from('activities')
        .insert({
          organiser_id: userId,
          organised_by_association_id: d.organisedBy.kind === 'association' ? d.organisedBy.id : null,
          organised_by_collectif_id: d.organisedBy.kind === 'collectif' ? d.organisedBy.id : null,
          category_id: d.categoryId,
          title: d.title,
          description: d.description,
          place_label: d.place.label,
          place: toPoint(d.place.lon, d.place.lat),
          recurrence_kind: r.kind,
          recurrence_interval_days: r.kind === 'every_n_days' ? r.days : null,
          recurrence_weekdays: r.kind === 'weekdays' ? r.weekdays : null,
          start_date: d.startDate,
          start_time: d.startTime,
          max_size: d.maxSize,
          newcomer_friendly: d.newcomerFriendly,
          approval_mode: d.approvalMode,
        })
        .select('id')
        .single(),
    (row) => ({ id: row.id as string }),
  );
}

export function getActivity(id: string): Promise<ApiResult<{ activity: ActivityPage | null }>> {
  return run(
    () => supabase.rpc('get_activity', { p_id: id }),
    (data) => ({ activity: data ? mapActivity(data) : null }),
  );
}

export function myActivities(): Promise<ApiResult<{ activities: MyActivity[] }>> {
  return run(
    () => supabase.rpc('my_activities'),
    (data) => ({
      activities: ((data ?? []) as any[]).map((a) => ({
        id: a.id,
        title: a.title,
        placeLabel: a.place_label,
        categoryIcon: a.category_icon,
        isOrganiser: !!a.is_organiser,
        myStatus: a.my_status,
        nextSession: a.next_session ? mapSession(a.next_session) : null,
      })),
    }),
  );
}

/** The database decides the status from the activity's approval mode. */
export function joinActivity(id: string): Promise<ApiResult<{ status: MyStatus }>> {
  return runAsUser(
    (userId) =>
      supabase
        .from('activity_members')
        .insert({ activity_id: id, user_id: userId })
        .select('status')
        .single(),
    (row) => ({ status: row.status as MyStatus }),
  );
}

export function leaveActivity(id: string): Promise<ApiResult> {
  return runAsUser(
    (userId) =>
      supabase.from('activity_members').delete().eq('activity_id', id).eq('user_id', userId),
    none,
  );
}

export function setAttendance(
  sessionId: string,
  status: 'confirmed' | 'cancelled',
  guestCount: 0 | 1,
): Promise<ApiResult> {
  return runAsUser(
    (userId) =>
      supabase.from('attendances').upsert(
        { session_id: sessionId, user_id: userId, status, guest_count: guestCount },
        { onConflict: 'session_id,user_id' },
      ),
    none,
  );
}

export function updateSession(sessionId: string, patch: SessionPatch): Promise<ApiResult> {
  const row: {
    starts_at?: string;
    place_label?: string;
    place?: string;
    is_discovery?: boolean;
    status?: string;
  } = {};
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.placeLabel !== undefined) row.place_label = patch.placeLabel;
  if (patch.place !== undefined) row.place = toPoint(patch.place.lon, patch.place.lat);
  if (patch.isDiscovery !== undefined) row.is_discovery = patch.isDiscovery;
  if (patch.status !== undefined) row.status = patch.status;
  return run(
    () => supabase.from('sessions').update(row).eq('id', sessionId).select('id'),
    none,
    { expectRows: true },
  );
}

/** Accepting makes the applicant a member; declining marks the row 'removed'. */
export function decideJoinRequest(
  activityId: string,
  userId: string,
  accept: boolean,
): Promise<ApiResult> {
  return run(
    () =>
      supabase
        .from('activity_members')
        .update({ status: accept ? 'member' : 'removed' })
        .eq('activity_id', activityId)
        .eq('user_id', userId)
        .select('user_id'),
    none,
    { expectRows: true },
  );
}

export function setWelcomeMember(activityId: string, userId: string | null): Promise<ApiResult> {
  return run(
    () =>
      supabase
        .from('activities')
        .update({ welcome_member_id: userId })
        .eq('id', activityId)
        .select('id'),
    none,
    { expectRows: true },
  );
}

export interface RosterEntry {
  userId: string;
  firstName: string;
  photoUrl: string | null;
  status: 'member' | 'pending';
}

/** Organiser only: members and pending requests with first names (the database refuses anyone else). */
export function activityRoster(activityId: string): Promise<ApiResult<{ people: RosterEntry[] }>> {
  return run(
    () => supabase.rpc('activity_roster', { p_activity: activityId }),
    (data) => ({
      people: ((data ?? []) as any[]).map((r) => ({
        userId: r.user_id as string,
        firstName: r.first_name as string,
        photoUrl: (r.photo_url ?? null) as string | null,
        status: r.status as 'member' | 'pending',
      })),
    }),
  );
}

/** Soft delete: the history of past sessions is kept. */
export function archiveActivity(activityId: string): Promise<ApiResult> {
  return run(
    () =>
      supabase
        .from('activities')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', activityId)
        .select('id'),
    none,
    { expectRows: true },
  );
}
