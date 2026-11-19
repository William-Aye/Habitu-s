import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createHandler, type QueueRow } from './handler.ts';
import { cronBearer, serverKey } from '../_shared/keys.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  serverKey(),
  { auth: { persistSession: false } },
);

Deno.serve(createHandler({
  serviceKey: cronBearer(),
  async fetchQueue(limit) {
    const { data, error } = await supabase
      .from('storage_deletions')
      .select('id, bucket, path')
      .order('id', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as QueueRow[];
  },
  async remove(bucket, paths) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw error;
  },
  async clear(ids) {
    const { error } = await supabase.from('storage_deletions').delete().in('id', ids);
    if (error) throw error;
  },
}));
