import { supabase } from '../../lib/supabase';
import { run, runAsUser, toPoint } from '../activities/errors';
import type { ApiResult, Candidate, CollectifPage, MyCollectif } from '../activities/types';

const none = () => ({});

export function createCollectif(input: {
  name: string;
  description: string;
  town: { label: string; lon: number; lat: number };
}): Promise<ApiResult<{ id: string }>> {
  return runAsUser(
    (userId) =>
      supabase
        .from('collectifs')
        .insert({
          name: input.name,
          description: input.description,
          town_label: input.town.label,
          town_point: toPoint(input.town.lon, input.town.lat),
          created_by: userId,
        })
        .select('id')
        .single(),
    (row) => ({ id: row.id as string }),
  );
}

export function getCollectif(id: string): Promise<ApiResult<{ collectif: CollectifPage | null }>> {
  return run(
    () => supabase.rpc('get_collectif', { p_id: id }),
    (c) => ({
      collectif: c
        ? {
            id: c.id,
            name: c.name,
            description: c.description ?? null,
            townLabel: c.town_label,
            lon: c.lon,
            lat: c.lat,
            organisers: (c.organisers ?? []).map((o: any) => ({
              firstName: o.first_name,
              photoUrl: o.photo_url ?? null,
              role: o.role,
            })),
            activities: (c.activities ?? []).map((a: any) => ({
              id: a.id,
              title: a.title,
              nextStartsAt: a.next_starts_at ?? null,
            })),
            myRole: c.my_role ?? null,
          }
        : null,
    }),
  );
}

/** Collectifs where I am an active responsable or organiser. */
export function myCollectifs(): Promise<ApiResult<{ collectifs: MyCollectif[] }>> {
  return runAsUser(
    (userId) =>
      supabase
        .from('collectif_members')
        .select('role, collectifs(id, name, town_label)')
        .eq('user_id', userId)
        .eq('status', 'active'),
    (rows) => ({
      collectifs: ((rows ?? []) as any[])
        .filter((r) => r.collectifs)
        .map((r) => ({
          id: r.collectifs.id,
          name: r.collectifs.name,
          townLabel: r.collectifs.town_label,
          role: r.role,
        })),
    }),
  );
}

/** Invitations to organise a collectif that I have not answered yet (my own rows, status 'invited'). */
export function myCollectifInvitations(): Promise<
  ApiResult<{ invitations: { id: string; name: string; townLabel: string }[] }>
> {
  return runAsUser(
    (userId) =>
      supabase
        .from('collectif_members')
        .select('collectifs(id, name, town_label)')
        .eq('user_id', userId)
        .eq('status', 'invited'),
    (rows) => ({
      invitations: ((rows ?? []) as any[])
        .filter((r) => r.collectifs)
        .map((r) => ({
          id: r.collectifs.id,
          name: r.collectifs.name,
          townLabel: r.collectifs.town_label,
        })),
    }),
  );
}

export function inviteOrganiser(collectifId: string, userId: string): Promise<ApiResult> {
  return run(
    () =>
      supabase.from('collectif_members').insert({
        collectif_id: collectifId,
        user_id: userId,
        role: 'organiser',
        status: 'invited',
      }),
    none,
  );
}

export function answerInvitation(collectifId: string, accept: boolean): Promise<ApiResult> {
  return runAsUser(
    (userId) =>
      accept
        ? supabase
            .from('collectif_members')
            .update({ status: 'active' })
            .eq('collectif_id', collectifId)
            .eq('user_id', userId)
            .select('user_id')
        : supabase
            .from('collectif_members')
            .delete()
            .eq('collectif_id', collectifId)
            .eq('user_id', userId)
            .select('user_id'),
    none,
    { expectRows: true },
  );
}

export function leaveCollectif(id: string): Promise<ApiResult> {
  return runAsUser(
    (userId) =>
      supabase
        .from('collectif_members')
        .delete()
        .eq('collectif_id', id)
        .eq('user_id', userId)
        .select('user_id'),
    none,
    { expectRows: true },
  );
}

export function deleteCollectif(id: string): Promise<ApiResult> {
  return run(() => supabase.from('collectifs').delete().eq('id', id).select('id'), none, {
    expectRows: true,
  });
}

/** Name, description and, when given, the town (a commune centre; the database snaps it). */
export function updateCollectif(
  id: string,
  input: { name: string; description: string; town?: { label: string; lon: number; lat: number } },
): Promise<ApiResult> {
  const patch: { name: string; description: string; town_label?: string; town_point?: string } = { name: input.name, description: input.description };
  if (input.town) {
    patch.town_label = input.town.label;
    patch.town_point = toPoint(input.town.lon, input.town.lat);
  }
  return run(() => supabase.from('collectifs').update(patch).eq('id', id).select('id'), none, {
    expectRows: true,
  });
}

/** True while I have an invitation to organise this collectif that I have not answered. */
export function myInvitation(collectifId: string): Promise<ApiResult<{ invited: boolean }>> {
  return runAsUser(
    (userId) =>
      supabase
        .from('collectif_members')
        .select('role, status')
        .eq('collectif_id', collectifId)
        .eq('user_id', userId)
        .eq('status', 'invited'),
    (rows) => ({ invited: Array.isArray(rows) && rows.length > 0 }),
  );
}

/** People who could be invited as organiser: members of the collectif's activities. */
export function listCandidates(collectifId: string): Promise<ApiResult<{ candidates: Candidate[] }>> {
  return run(
    () => supabase.rpc('collectif_candidates', { p_collectif: collectifId }),
    (rows) => ({
      candidates: ((rows ?? []) as any[]).map((r) => ({
        userId: r.user_id,
        firstName: r.first_name,
        photoUrl: r.photo_url ?? null,
      })),
    }),
  );
}
