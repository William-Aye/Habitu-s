import { supabase } from '../../lib/supabase';
import { run, runAsUser, toPoint } from '../activities/errors';
import type { ApiResult, CollectifPage, MyCollectif } from '../activities/types';

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
        } as any)
        .select('id')
        .single(),
    (row) => ({ id: row.id as string }),
  );
}

export function getCollectif(id: string): Promise<ApiResult<{ collectif: CollectifPage | null }>> {
  return run(
    () => supabase.rpc('get_collectif', { p_id: id } as any),
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

export function inviteOrganiser(collectifId: string, userId: string): Promise<ApiResult> {
  return run(
    () =>
      supabase.from('collectif_members').insert({
        collectif_id: collectifId,
        user_id: userId,
        role: 'organiser',
        status: 'invited',
      } as any),
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
        : supabase
            .from('collectif_members')
            .delete()
            .eq('collectif_id', collectifId)
            .eq('user_id', userId),
    none,
  );
}

export function leaveCollectif(id: string): Promise<ApiResult> {
  return runAsUser(
    (userId) =>
      supabase.from('collectif_members').delete().eq('collectif_id', id).eq('user_id', userId),
    none,
  );
}

export function deleteCollectif(id: string): Promise<ApiResult> {
  return run(() => supabase.from('collectifs').delete().eq('id', id), none);
}
