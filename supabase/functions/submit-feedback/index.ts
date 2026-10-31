import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createHandler } from './handler.ts';

const list = (name: string) => (Deno.env.get(name) ?? '').split(',').map((v) => v.trim()).filter(Boolean);

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(createHandler({
  turnstileSecret: Deno.env.get('TURNSTILE_SECRET') ?? '',
  turnstileHostnames: list('TURNSTILE_HOSTNAMES'),
  allowedOrigins: list('ALLOWED_ORIGINS'),
  now: () => new Date(),
  fetch: (input, init) => fetch(input, init),
  async countAnonymousSince(since) {
    const { count, error } = await supabase
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'anonymous')
      .gte('created_at', since.toISOString());
    if (error) throw error;
    return count ?? 0;
  },
  async insertFeedback(row) {
    const { error } = await supabase.from('feedback').insert(row);
    if (error) throw error;
  },
}));
