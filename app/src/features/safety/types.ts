export type ReportTargetType = 'user' | 'activity' | 'message' | 'association' | 'collectif' | 'session';

export type ReportReason =
  | 'unsafe_place'
  | 'inappropriate_behaviour'
  | 'harassment'
  | 'fake_or_spam'
  | 'did_not_happen'
  | 'other'
  | 'child_safety';

export interface ReportTarget {
  type: ReportTargetType;
  id: string;
  /** Reported from an activity with children: the child-safety reason comes first. */
  withChildren?: boolean;
}

export type SafetyError = 'not_allowed' | 'limit_reached' | 'signed_out' | 'network' | 'unknown';

export type SafetyResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: SafetyError };

export const MAX_DETAILS = 500;

/** The reasons that fit a kind of target, in display order. */
export function reasonsFor(type: ReportTargetType, opts: { withChildren?: boolean } = {}): ReportReason[] {
  const reasons: ReportReason[] = [];
  if (opts.withChildren && (type === 'user' || type === 'activity' || type === 'session' || type === 'message')) {
    reasons.push('child_safety');
  }
  if (type === 'activity' || type === 'session' || type === 'association') reasons.push('unsafe_place');
  reasons.push('inappropriate_behaviour', 'harassment', 'fake_or_spam');
  if (type === 'activity' || type === 'session') reasons.push('did_not_happen');
  reasons.push('other');
  return reasons;
}
