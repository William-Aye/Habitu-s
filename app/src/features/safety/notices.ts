import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../account/useSession';
import { authed } from './authed';
import type { ReportTargetType, SafetyResult } from './types';

export type ModerationDecision = 'warn' | 'remove' | 'ban';

export interface ModerationDecisionNotice {
  reportId: string;
  decision: ModerationDecision;
  statementOfReasons: string;
  decidedAt: string;
  targetType: ReportTargetType;
  targetId: string;
}

export interface HandledReport {
  reportId: string;
  status: string;
  decidedAt: string | null;
}

export interface ModerationNotices {
  decisions: ModerationDecisionNotice[];
  handledReports: HandledReport[];
}

const DECISIONS: ModerationDecision[] = ['warn', 'remove', 'ban'];
const TARGETS: ReportTargetType[] = ['user', 'activity', 'message', 'association', 'collectif', 'session'];

/** Reads the decisions about my content and the outcome of my own reports. */
export function fetchModerationNotices(): Promise<SafetyResult<{ notices: ModerationNotices }>> {
  return authed(
    () => supabase.rpc('my_moderation_notices'),
    (data): { notices: ModerationNotices } => ({
      notices: {
        decisions: ((data?.decisions ?? []) as any[])
          .filter((d) => DECISIONS.includes(d.decision))
          .map((d) => ({
            reportId: d.report_id,
            decision: d.decision,
            statementOfReasons: d.statement_of_reasons ?? '',
            decidedAt: d.decided_at,
            targetType: TARGETS.includes(d.target_type) ? d.target_type : 'user',
            targetId: d.target_id,
          })),
        handledReports: ((data?.handled_reports ?? []) as any[]).map((r) => ({
          reportId: r.report_id,
          status: r.status,
          decidedAt: r.decided_at ?? null,
        })),
      },
    }),
  );
}

/** Every item has a stable id: decisions and handled reports share the report id space. */
export function noticeIds(n: ModerationNotices): string[] {
  const ids = new Set<string>();
  n.decisions.forEach((d) => ids.add(`d:${d.reportId}`));
  n.handledReports.forEach((r) => ids.add(`r:${r.reportId}`));
  return [...ids];
}

const seenKey = (userId: string) => `moderation.seen.v1:${userId}`;
const MAX_SEEN = 500;

export async function readSeen(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(seenKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remembers what the person has seen. Best effort: a failed write only means the badge comes back. */
export async function markSeen(userId: string, ids: string[]): Promise<void> {
  try {
    const seen = await readSeen(userId);
    ids.forEach((id) => seen.add(id));
    await AsyncStorage.setItem(seenKey(userId), JSON.stringify([...seen].slice(-MAX_SEEN)));
  } catch {
    // Nothing to do.
  }
}

/** Items not seen yet. A failed read counts nothing, so a badge never appears on a guess. */
export async function unreadCount(userId: string): Promise<number> {
  const r = await fetchModerationNotices();
  if (!r.ok) return 0;
  const seen = await readSeen(userId);
  return noticeIds(r.notices).filter((id) => !seen.has(id)).length;
}

/** The number of unseen moderation items for the signed-in person (0 while unknown); `refresh` re-reads it. */
export function useModerationUnread(): { count: number; refresh(): void } {
  const { status, userId } = useSession();
  // The count is kept with the person it was read for, so another person never sees it.
  const [read, setRead] = useState<{ userId: string; count: number } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (status !== 'ready' || !userId) return;
    let active = true;
    unreadCount(userId).then((n) => active && setRead({ userId, count: n }));
    return () => {
      active = false;
    };
  }, [status, userId, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { count: status === 'ready' && userId && read?.userId === userId ? read.count : 0, refresh };
}
