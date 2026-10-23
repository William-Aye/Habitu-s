import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../account/useSession';
import { deleteMessage, fetchMessages, markRead, myChats, setMuted } from './api';
import {
  discard as discardPending,
  enqueue,
  pending,
  ready as outboxReady,
  retry as retryPending,
  subscribe,
} from './outbox';
import type { ChatError, ChatMessage, PendingMessage } from './types';

const PAGE = 50;
const TICK_MS = 15_000;

export type ChatState = 'loading' | 'not_member' | 'ready' | 'error';
export type DisplayMessage = ChatMessage & { pending: PendingMessage | null };

const older = (a: ChatMessage, b: ChatMessage) =>
  a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);

/**
 * Merges a re-read of the latest page into what is open (newest first). Anything inside the page's range is
 * the server's word (so a deleted or newly hidden message goes away); older pages already loaded stay.
 */
function mergeLatest(existing: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  if (latest.length < PAGE) return latest;
  const boundary = latest[latest.length - 1];
  const ids = new Set(latest.map((m) => m.id));
  return [...latest, ...existing.filter((m) => !ids.has(m.id) && older(m, boundary))];
}

export function useChat(activityId: string, focused = true) {
  const { status, userId } = useSession();
  const active = status === 'ready' && !!userId;
  const [state, setState] = useState<ChatState>('loading');
  const [archived, setArchived] = useState(false);
  const [server, setServer] = useState<ChatMessage[]>([]); // newest first
  const [hasOlder, setHasOlder] = useState(false);
  const [pend, setPend] = useState<PendingMessage[]>([]);
  const [muted, setMutedState] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [muteBusy, setMuteBusy] = useState(false);

  const alive = useRef(true);
  const running = useRef(false);
  const again = useRef(false);
  const replaceNext = useRef(false);
  const loadingOlder = useRef(false);
  const serverRef = useRef<ChatMessage[]>([]);
  const hasOlderRef = useRef(false);

  // Latest values for callbacks that must not change identity.
  useEffect(() => {
    serverRef.current = server;
    hasOlderRef.current = hasOlder;
  }, [server, hasOlder]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Re-reads the latest page. Overlapping calls collapse into one more pass. `replace` drops older pages. */
  const refresh = useCallback(
    async (replace = false) => {
      if (replace) replaceNext.current = true;
      if (running.current) {
        again.current = true;
        return;
      }
      running.current = true;
      try {
        do {
          again.current = false;
          const replacing = replaceNext.current;
          replaceNext.current = false;
          const r = await fetchMessages(activityId, { limit: PAGE });
          if (!alive.current) return;
          if (!r.ok) {
            setState((s) => (s === 'loading' ? 'error' : s));
          } else if (!r.page) {
            setState('not_member');
          } else {
            const { messages, archived: arch } = r.page;
            setState('ready');
            setArchived(arch);
            if (replacing) {
              setServer(messages);
              setHasOlder(messages.length >= PAGE);
            } else {
              setServer((cur) => mergeLatest(cur, messages));
            }
          }
        } while (again.current);
      } finally {
        running.current = false;
      }
    },
    [activityId],
  );

  const load = useCallback(() => {
    setState('loading');
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (active) void refresh(true);
  }, [active, refresh]);

  // Title and mute state of this discussion.
  useEffect(() => {
    if (!active) return;
    void myChats().then((r) => {
      if (!alive.current || !r.ok) return;
      const chat = r.chats.find((c) => c.activityId === activityId);
      if (chat) {
        setMutedState(chat.muted);
        setTitle(chat.title);
      }
    });
  }, [active, activityId]);

  // Realtime is only a signal: access and blocks stay enforced by the RPC.
  useEffect(() => {
    if (!active) return;
    let subscribed = 0;
    const channel = supabase
      .channel(`chat:${activityId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `activity_id=eq.${activityId}` },
        () => {
          void refresh();
        },
      )
      // A DELETE carries only the primary key and cannot be filtered by activity: act only on ids we show.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload: any) => {
        const id = payload?.old?.id;
        if (!id) return;
        setServer((cur) => (cur.some((m) => m.id === id) ? cur.filter((m) => m.id !== id) : cur));
      })
      .subscribe((s: string) => {
        if (s !== 'SUBSCRIBED') return;
        subscribed += 1;
        // A re-subscription may have missed signals: catch up.
        if (subscribed > 1) void refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [active, activityId, refresh]);

  // Unsent messages of this account for this discussion.
  const prevPending = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!active || !userId) return;
    let on = true;
    const sync = () => {
      const next = pending(activityId, userId);
      const gone = [...prevPending.current].some((id) => !next.some((p) => p.id === id));
      prevPending.current = new Set(next.map((p) => p.id));
      setPend(next);
      // A message that left the outbox was sent (or dropped): read it back from the server.
      if (gone) void refresh();
    };
    void outboxReady().then(() => on && sync());
    const off = subscribe(sync);
    return () => {
      on = false;
      off();
    };
  }, [active, userId, activityId, refresh]);

  // `stalled` is derived at read time: re-read it while something is still sending.
  const waiting = pend.some((p) => p.state === 'sending');
  useEffect(() => {
    if (!waiting || !userId) return;
    const timer = setInterval(() => setPend(pending(activityId, userId)), TICK_MS);
    return () => clearInterval(timer);
  }, [waiting, activityId, userId]);

  const newestId = server[0]?.id ?? null;
  useEffect(() => {
    if (state === 'ready' && focused) void markRead(activityId);
  }, [state, focused, newestId, activityId]);

  const messages = useMemo<DisplayMessage[]>(() => {
    const serverIds = new Set(server.map((m) => m.id));
    const sent = [...server].reverse().map((m): DisplayMessage => ({ ...m, pending: null }));
    const unsent = pend
      .filter((p) => !serverIds.has(p.id))
      .map(
        (p): DisplayMessage => ({
          id: p.id,
          body: p.body,
          createdAt: p.createdAt,
          sender: { id: p.userId, firstName: '', photoUrl: null },
          isMine: true,
          pending: p,
        }),
      );
    return [...sent, ...unsent];
  }, [server, pend]);

  const loadOlder = useCallback(async () => {
    const oldest = serverRef.current[serverRef.current.length - 1];
    if (!oldest || !hasOlderRef.current || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      // The cursor is the pair of raw server values: never rebuilt through Date.
      const r = await fetchMessages(activityId, { before: { at: oldest.createdAt, id: oldest.id }, limit: PAGE });
      if (!alive.current || !r.ok) return;
      if (!r.page) {
        setState('not_member');
        return;
      }
      const batch = r.page.messages;
      setServer((cur) => {
        const ids = new Set(cur.map((m) => m.id));
        return [...cur, ...batch.filter((m) => !ids.has(m.id))];
      });
      setHasOlder(batch.length >= PAGE);
    } finally {
      loadingOlder.current = false;
    }
  }, [activityId]);

  const send = useCallback(
    (body: string): boolean => (userId ? enqueue(userId, activityId, body) !== null : false),
    [userId, activityId],
  );
  const retry = useCallback((id: string) => void retryPending(id), []);
  const discard = useCallback((id: string) => discardPending(id), []);

  const remove = useCallback(async (id: string): Promise<{ ok: true } | { ok: false; error: ChatError }> => {
    const r = await deleteMessage(id);
    if (r.ok && alive.current) setServer((cur) => cur.filter((m) => m.id !== id));
    return r;
  }, []);

  const toggleMute = useCallback(async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    const next = !muted;
    const r = await setMuted(activityId, next);
    if (!alive.current) return;
    setMuteBusy(false);
    if (r.ok) setMutedState(next);
  }, [muteBusy, muted, activityId]);

  const reload = useCallback(() => refresh(true), [refresh]);

  return {
    state,
    archived,
    messages,
    title,
    loadOlder,
    hasOlder,
    send,
    retry,
    discard,
    remove,
    reload,
    retryLoad: load,
    muted,
    muteBusy,
    toggleMute,
  };
}
