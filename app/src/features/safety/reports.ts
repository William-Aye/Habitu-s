import { supabase } from '../../lib/supabase';
import { authed } from './authed';
import type { ReportReason, ReportTargetType, SafetyResult } from './types';

export { reasonsFor, MAX_DETAILS } from './types';
export type { ReportReason, ReportTargetType, SafetyError, SafetyResult } from './types';

/**
 * The one way to report anything. The reporter is the caller (set by the database), and nothing is read
 * back: reporters can only read a few columns of a report.
 */
export function reportTarget(
  type: ReportTargetType,
  id: string,
  reason: ReportReason,
  details?: string,
): Promise<SafetyResult> {
  return authed(() =>
    supabase.from('reports').insert({
      target_type: type,
      target_id: id,
      reason,
      details: details?.trim() ? details.trim() : null,
    }),
  );
}
