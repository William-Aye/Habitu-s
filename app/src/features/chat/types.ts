/** signed_out: no session to send with. Never a verdict on the message, so the outbox keeps it queued. */
export type ChatError = 'not_allowed' | 'limit_reached' | 'network' | 'unknown' | 'signed_out';

export type ChatResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: ChatError };

export interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  sender: { id: string; firstName: string; photoUrl: string | null };
  isMine: boolean;
}

export interface ChatPage {
  archived: boolean;
  messages: ChatMessage[];
}

export interface ChatSummary {
  activityId: string;
  title: string;
  lastMessage: { body: string; createdAt: string; senderFirstName: string } | null;
  unreadCount: number;
  muted: boolean;
}

export interface PendingMessage {
  id: string;
  /** The account that wrote it: a queue is only ever sent by its own account. */
  userId: string;
  activityId: string;
  body: string;
  createdAt: string;
  state: 'sending' | 'failed';
  error?: Exclude<ChatError, 'signed_out'>;
  /** Send attempts that ended without a verdict (network). */
  attempts: number;
  /** Derived: still sending after 3 attempts or 2 minutes, so the UI can offer a manual retry. */
  stalled: boolean;
}

export type ReportReason = 'inappropriate' | 'harassment' | 'scam' | 'other';
