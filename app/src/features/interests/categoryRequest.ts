import { supabase } from '../../lib/supabase';

const MIN = 2;
const MAX = 80;

export async function requestCategory(name: string): Promise<'sent' | 'signed_out' | 'invalid'> {
  const trimmed = name.trim();
  const length = Array.from(trimmed).length;
  if (length < MIN || length > MAX) return 'invalid';
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return 'signed_out';
  const { error } = await supabase
    .from('category_requests')
    .insert({ user_id: userId, requested_name: trimmed, status: 'pending' });
  if (error) throw new Error('category request failed');
  return 'sent';
}
