export type ChatError = 'not_allowed' | 'limit_reached' | 'network' | 'unknown';

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
  activityId: string;
  body: string;
  createdAt: string;
  state: 'sending' | 'failed';
  error?: ChatError;
}

export type ReportReason = 'inappropriate' | 'harassment' | 'scam' | 'other';
