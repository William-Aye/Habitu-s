import { supabase } from '../../lib/supabase';
import { normaliseQuery } from '../explore/types';

export interface Category {
  id: string;
  slug: string;
  nameFr: string;
  nameEn: string;
  icon: string;
  parentId: string | null;
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, parent_id, slug, name_fr, name_en, icon, sort_order')
    .order('sort_order', { ascending: true });
  if (error) throw new Error('categories read failed');
  return (data ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    nameFr: r.name_fr,
    nameEn: r.name_en,
    icon: r.icon,
    parentId: r.parent_id,
  }));
}

function fold(text: string): string {
  return normaliseQuery(text).normalize('NFD').replace(/\p{M}/gu, '');
}

/** Accent- and case-insensitive match in either language; a matching child also returns its parent. */
export function filterCategories(all: Category[], text: string, _lang: 'fr' | 'en'): Category[] {
  const needle = fold(text);
  if (needle === '') return all;
  const matches = all.filter(
    (c) => fold(c.nameFr).includes(needle) || fold(c.nameEn).includes(needle),
  );
  const keep = new Set(matches.map((c) => c.id));
  for (const c of matches) if (c.parentId) keep.add(c.parentId);
  return all.filter((c) => keep.has(c.id));
}
