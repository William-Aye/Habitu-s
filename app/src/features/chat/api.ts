import { supabase } from '../../lib/supabase';
import { run, runAsUser } from '../activities/errors';
import type { ApiResult } from '../activities/types';
import type { ChatError, ChatMessage, ChatPage, ChatResult, ChatSummary, ReportReason } from './types';

const none = () => ({});

/** The shared errors cover more cases than chat shows; anything else is unknown. */
function narrow<T extends object>(r: ApiResult<T>): ChatResult<T> {
  if (r.ok) return r;
  const known: string[] = ['not_allowed', 'limit_reached', 'network'];
  return { ok: false, error: (known.includes(r.error) ? r.error : 'unknown') as ChatError };
}

function mapMessage(m: any): ChatMessage {
  return {
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    sender: { id: m.sender.id, firstName: m.sender.first_name, photoUrl: m.sender.photo_url ?? null },
    isMine: !!m.is_mine,
  };
}

/** Newest first. A null page means the caller is not a member (or no longer is). */
export async function fetchMessages(
  activityId: string,
  opts: { before?: { at: string; id: string }; limit?: number } = {},
): Promise<ChatResult<{ page: ChatPage | null }>> {
  const args: Record<string, unknown> = { p_activity: activityId };
  // A keyset cursor is the pair: sending only the timestamp would skip or repeat same-instant rows.
  if (opts.before) {
    args.p_before_at = opts.before.at;
    args.p_before_id = opts.before.id;
  }
  if (opts.limit !== undefined) args.p_limit = opts.limit;
  return narrow(
    await run(
      () => supabase.rpc('chat_messages', args as any),
      (data) => ({
        page: data
          ? { archived: !!data.archived, messages: ((data.messages ?? []) as any[]).map(mapMessage) }
          : null,
      }),
    ),
  );
}

/** A duplicate id (23505) means an earlier attempt already went through: that is sent. */
export async function sendMessage(activityId: string, id: string, body: string): Promise<ChatResult> {
  return narrow(
    await runAsUser(async (userId) => {
      const res = await supabase.from('messages').insert({ id, activity_id: activityId, body, sender_id: userId });
      return res.error?.code === '23505' ? { data: null, error: null } : res;
    }, none),
  );
}

export async function deleteMessage(id: string): Promise<ChatResult> {
  return narrow(
    await run(() => supabase.from('messages').delete().eq('id', id).select('id'), none, { expectRows: true }),
  );
}

export async function myChats(): Promise<ChatResult<{ chats: ChatSummary[] }>> {
  return narrow(
    await run(
      () => supabase.rpc('my_chats'),
      (data) => ({
        chats: ((data ?? []) as any[]).map(
          (c): ChatSummary => ({
            activityId: c.activity_id,
            title: c.title,
            lastMessage: c.last_message
              ? {
                  body: c.last_message.body,
                  createdAt: c.last_message.created_at,
                  senderFirstName: c.last_message.sender_first_name,
                }
              : null,
            unreadCount: c.unread_count ?? 0,
            muted: !!c.muted,
          }),
        ),
      }),
    ),
  );
}

export async function markRead(activityId: string): Promise<ChatResult> {
  return narrow(await run(() => supabase.rpc('mark_chat_read', { p_activity: activityId }), none));
}

export async function setMuted(activityId: string, muted: boolean): Promise<ChatResult> {
  return narrow(await run(() => supabase.rpc('set_chat_muted', { p_activity: activityId, p_muted: muted }), none));
}

// The reports table has its own reason list; harassment has none, so it is filed as inappropriate behaviour
// with the detail kept for the reviewer.
const REPORT_REASON = {
  inappropriate: { reason: 'inappropriate_behaviour' },
  harassment: { reason: 'inappropriate_behaviour', details: 'harassment' },
  scam: { reason: 'fake_or_spam' },
  other: { reason: 'other' },
} as const;

export async function reportMessage(messageId: string, reason: ReportReason): Promise<ChatResult> {
  return narrow(
    await runAsUser(
      (userId) =>
        supabase
          .from('reports')
          .insert({ reporter_id: userId, target_type: 'message', target_id: messageId, ...REPORT_REASON[reason] }),
      none,
    ),
  );
}

export async function blockUser(userId: string): Promise<ChatResult> {
  return narrow(
    await runAsUser(
      (me) =>
        supabase
          .from('blocks')
          .upsert({ blocker_id: me, blocked_id: userId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }),
      none,
    ),
  );
}
