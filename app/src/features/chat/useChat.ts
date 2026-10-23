import { randomUUID } from 'expo-crypto';
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
export type ChatNotice = 'sync' | 'mute';
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
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  const [needsAccount, setNeedsAccount] = useState(false);
  // Sent messages that left the outbox: shown until a read that started after that moment has returned.
  const [linger, setLinger] = useState<{ p: PendingMessage; seq: number }[]>([]);

  // A new activity starts from scratch (reset while rendering, not in an effect).
  const [forId, setForId] = useState(activityId);
  if (forId !== activityId) {
    setForId(activityId);
    setState('loading');
    setArchived(false);
    setServer([]);
    setHasOlder(false);
    setPend([]);
    setLinger([]);
    setMutedState(false);
    setTitle(null);
    setMuteBusy(false);
    setNotice(null);
    setNeedsAccount(false);
  }

  const alive = useRef(true);
  const idRef = useRef(activityId);
  const running = useRef<string | null>(null);
  const again = useRef(false);
  const replaceNext = useRef(false);
  const loadingOlder = useRef(false);
  const fetchesStarted = useRef(0);
  const discarded = useRef<Set<string>>(new Set());
  const prevPending = useRef<Map<string, PendingMessage>>(new Map());
  const serverRef = useRef<ChatMessage[]>([]);
  const hasOlderRef = useRef(false);

  // The activity the screen is on now: a read for another one must not write.
  useEffect(() => {
    idRef.current = activityId;
    loadingOlder.current = false;
    prevPending.current = new Map();
  }, [activityId]);

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

  const stale = (id: string) => !alive.current || idRef.current !== id;

  /** Re-reads the latest page. Overlapping calls collapse into one more pass. `replace` drops older pages. */
  const refresh = useCallback(
    async (replace = false) => {
      if (replace) replaceNext.current = true;
      if (running.current === activityId) {
        again.current = true;
        return;
      }
      running.current = activityId;
      try {
        do {
          again.current = false;
          const replacing = replaceNext.current;
          replaceNext.current = false;
          const started = ++fetchesStarted.current;
          const r = await fetchMessages(activityId, { limit: PAGE });
          if (stale(activityId)) return;
          if (!r.ok) {
            if (r.error === 'signed_out') {
              setNeedsAccount(true);
            } else {
              setState((s) => (s === 'loading' ? 'error' : s));
              setNotice('sync');
            }
          } else if (!r.page) {
            setState('not_member');
          } else {
            const { messages, archived: arch } = r.page;
            setNotice((n) => (n === 'sync' ? null : n));
            setLinger((l) => l.filter((x) => x.seq >= started));
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
        if (running.current === activityId) running.current = null;
      }
    },
    [activityId],
  );

  const load = useCallback(() => {
    setState('loading');
    setNeedsAccount(false);
    setNotice(null);
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (active) void refresh(true);
  }, [active, refresh]);

  // Title and mute state of this discussion.
  useEffect(() => {
    if (!active) return;
    void myChats().then((r) => {
      if (stale(activityId) || !r.ok) return;
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
      // One topic per mount: realtime-js hands back the existing channel for a topic, and a channel that is
      // already subscribed (or still being removed) cannot take new callbacks.
      .channel(`chat:${activityId}:${randomUUID()}`)
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
  useEffect(() => {
    if (!active || !userId) return;
    let on = true;
    const sync = () => {
      const next = pending(activityId, userId);
      const nextIds = new Set(next.map((p) => p.id));
      const gone = [...prevPending.current.values()].filter((p) => !nextIds.has(p.id) && !discarded.current.has(p.id));
      prevPending.current = new Map(next.map((p) => [p.id, p]));
      setPend(next);
      if (gone.length > 0) {
        // Sent: keep the bubble until the read that follows has come back with the server copy.
        const seq = fetchesStarted.current;
        setLinger((l) => [...l, ...gone.map((p) => ({ p, seq }))]);
        void refresh();
      }
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
    // Failures stay silent: the next read marks it again.
    if (state === 'ready' && focused) void markRead(activityId);
  }, [state, focused, newestId, activityId]);

  const messages = useMemo<DisplayMessage[]>(() => {
    const serverIds = new Set(server.map((m) => m.id));
    const sent = [...server].reverse().map((m): DisplayMessage => ({ ...m, pending: null }));
    const unsent = pend
      .filter((p) => !serverIds.has(p.id))
      .map((p): DisplayMessage => ({ ...asMessage(p), pending: p }));
    const pendingIds = new Set(pend.map((p) => p.id));
    const sentLocal = linger
      .filter((x) => !serverIds.has(x.p.id) && !pendingIds.has(x.p.id))
      .map((x): DisplayMessage => ({ ...asMessage(x.p), pending: null }));
    return [...sent, ...sentLocal, ...unsent];
  }, [server, pend, linger]);

  const loadOlder = useCallback(async () => {
    const oldest = serverRef.current[serverRef.current.length - 1];
    if (!oldest || !hasOlderRef.current || loadingOlder.current) return;
    loadingOlder.current = true;
    try {
      // The cursor is the pair of raw server values: never rebuilt through Date.
      const r = await fetchMessages(activityId, { before: { at: oldest.createdAt, id: oldest.id }, limit: PAGE });
      if (stale(activityId)) return;
      if (!r.ok) {
        if (r.error === 'signed_out') setNeedsAccount(true);
        else setNotice('sync');
        return;
      }
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
  const discard = useCallback((id: string) => {
    discarded.current.add(id);
    discardPending(id);
  }, []);

  const remove = useCallback(async (id: string): Promise<{ ok: true } | { ok: false; error: ChatError }> => {
    const r = await deleteMessage(id);
    if (r.ok && alive.current) setServer((cur) => cur.filter((m) => m.id !== id));
    return r;
  }, []);

  // Not optimistic: the toggle only flips once the server has accepted it, so a failure leaves it as it was.
  const toggleMute = useCallback(async () => {
    if (muteBusy) return;
    setMuteBusy(true);
    const next = !muted;
    const r = await setMuted(activityId, next);
    if (stale(activityId)) return;
    setMuteBusy(false);
    if (r.ok) {
      setMutedState(next);
      setNotice((n) => (n === 'mute' ? null : n));
    } else {
      setNotice('mute');
    }
  }, [muteBusy, muted, activityId]);

  const reload = useCallback(() => refresh(true), [refresh]);

  return {
    state,
    archived,
    messages,
    title,
    notice,
    needsAccount,
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

function asMessage(p: PendingMessage): ChatMessage {
  return {
    id: p.id,
    body: p.body,
    createdAt: p.createdAt,
    sender: { id: p.userId, firstName: '', photoUrl: null },
    isMine: true,
  };
}
