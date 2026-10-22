import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createHandler } from './handler.ts';
import { embedQueryText } from './model.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(createHandler({
  embed: embedQueryText,
  async cacheGet(model, q) {
    const { data, error } = await supabase
      .from('query_embedding_cache')
      .select('embedding')
      .eq('model', model)
      .eq('query_norm', q)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    // PostgREST returns pgvector as the string "[0.1,0.2,...]".
    const raw = data.embedding as string | number[];
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  },
  async cachePut(model, q, v) {
    const { error } = await supabase
      .from('query_embedding_cache')
      .upsert({ model, query_norm: q, embedding: `[${v.join(',')}]` });
    if (error) throw error;
  },
}));
