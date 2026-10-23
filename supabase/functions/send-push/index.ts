import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createHandler, type ExpoTicket, type OutboxRow } from './handler.ts';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(createHandler({
  now: () => new Date(),
  async fetchOutbox(limit) {
    const { data, error } = await supabase.rpc('claim_outbox', { p_limit: limit });
    if (error) throw error;
    return (data ?? []) as OutboxRow[];
  },
  async markSent(ids) {
    const { error } = await supabase
      .from('notification_outbox')
      .update({ sent_at: new Date().toISOString() })
      .in('id', ids);
    if (error) throw error;
  },
  async markRetry(id, _err, next) {
    const { error } = await supabase
      .from('notification_outbox')
      .update({
        attempts: next.attempts,
        failed_at: next.failed ? new Date().toISOString() : null,
        send_after: (next.sendAfter ?? new Date()).toISOString(),
      })
      .eq('id', id);
    if (error) throw error;
  },
  async dropToken(token) {
    const { error } = await supabase.from('push_tokens').delete().eq('token', token);
    if (error) throw error;
  },
  async expoSend(messages) {
    const res = await fetch(EXPO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) throw new Error(`Expo responded ${res.status}`);
    const body = await res.json();
    return body.data as ExpoTicket[];
  },
}));
