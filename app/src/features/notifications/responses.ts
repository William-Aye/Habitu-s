import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { setAttendanceStatus } from '../activities/api';
import { supabase } from '../../lib/supabase';

const handled = new Set<string>();
const inFlight = new Set<string>();

export function resetHandledResponsesForTests(): void {
  handled.clear();
  inFlight.clear();
}

export function responseKey(response: Notifications.NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.actionIdentifier}`;
}

function payload(response: Notifications.NotificationResponse) {
  const data = (response.notification.request.content.data ?? {}) as {
    session_id?: unknown;
    activity_id?: unknown;
    collectif_id?: unknown;
    kind?: unknown;
    claim_id?: unknown;
  };
  return {
    sessionId: typeof data.session_id === 'string' ? data.session_id : null,
    activityId: typeof data.activity_id === 'string' ? data.activity_id : null,
    collectifId: typeof data.collectif_id === 'string' ? data.collectif_id : null,
    isChat: data.kind === 'chat_message',
    kind: typeof data.kind === 'string' ? data.kind : null,
    claimId: typeof data.claim_id === 'string' ? data.claim_id : null,
  };
}

const MODERATION_KINDS = ['report_handled', 'moderation_notice'];
const ACCOUNT_KINDS = [...MODERATION_KINDS, 'claim_decided', 'category_decided', 'inactivity_notice'];

/** The association a claim was about. The notification carries only the claim id; null when it cannot be read. */
async function claimAssociationId(claimId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('association_claims')
      .select('association_id')
      .eq('id', claimId)
      .maybeSingle();
    if (error) return null;
    return typeof data?.association_id === 'string' ? data.association_id : null;
  } catch {
    return null;
  }
}

/**
 * The kinds that are not about an activity: moderation information, the outcome of an association claim or
 * of a category request, and the inactivity warning. Returns false for every other kind.
 */
async function openAccountNotice(kind: string | null, claimId: string | null): Promise<boolean> {
  if (kind && MODERATION_KINDS.includes(kind)) {
    router.push('/moderation' as Href);
  } else if (kind === 'claim_decided') {
    const associationId = claimId ? await claimAssociationId(claimId) : null;
    if (associationId) router.push({ pathname: '/associations/[id]', params: { id: associationId } });
    else router.navigate('/(tabs)/profile' as Href);
  } else if (kind === 'category_decided') {
    router.push('/interests' as Href);
  } else if (kind === 'inactivity_notice') {
    router.navigate('/(tabs)/profile' as Href);
  } else {
    return false;
  }
  return true;
}

/** Only navigates to the activity (its page shows the account gate to a signed-out user); records nothing. */
export function openActivityFor(response: Notifications.NotificationResponse): void {
  const { activityId, collectifId, isChat, kind } = payload(response);
  // Signed out: only the moderation page can open on its own (it asks for the account itself).
  if (kind && MODERATION_KINDS.includes(kind)) router.push('/moderation' as Href);
  else if (isChat && activityId) router.push(`/discussions/${activityId}` as Href);
  else if (activityId) router.push({ pathname: '/activites/[id]', params: { id: activityId } });
  else if (collectifId) router.push({ pathname: '/collectifs/[id]', params: { id: collectifId } });
}

/**
 * Reacts to a tap on a notification or one of its actions. The same response can reach the app twice
 * (cold-start lookup and live listener), so each is handled once, marked only after the attempt ends.
 * If an answer cannot be recorded, the activity still opens with a flag so its page can say so.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  opts: { alreadyOpened?: boolean } = {},
): Promise<void> {
  const key = responseKey(response);
  if (handled.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  const { sessionId, activityId, collectifId, isChat, kind, claimId } = payload(response);
  if (kind && ACCOUNT_KINDS.includes(kind)) {
    // Not about an activity: no answer to record, only a screen to open.
    inFlight.delete(key);
    handled.add(key);
    if (!opts.alreadyOpened) await openAccountNotice(kind, claimId);
    return;
  }
  let failed = false;
  try {
    const answer =
      response.actionIdentifier === 'yes' ? 'confirmed' : response.actionIdentifier === 'no' ? 'cancelled' : null;
    if (sessionId && answer && !isChat) {
      try {
        const r = await setAttendanceStatus(sessionId, answer);
        failed = !r.ok;
      } catch {
        failed = true;
      }
    }
  } finally {
    inFlight.delete(key);
    handled.add(key);
  }
  if (!activityId) {
    // A collectif invitation: its page holds the accept / decline buttons.
    if (collectifId && !opts.alreadyOpened) {
      router.push({ pathname: '/collectifs/[id]', params: { id: collectifId } });
    }
    return;
  }
  if (isChat) {
    // The reminder actions do not apply to chat: a tap just opens the discussion, once.
    if (!opts.alreadyOpened) router.push(`/discussions/${activityId}` as Href);
    return;
  }
  if (!opts.alreadyOpened) {
    router.push({
      pathname: '/activites/[id]',
      params: failed ? { id: activityId, reminder: 'failed' } : { id: activityId },
    });
  } else if (failed) {
    // The page is already on screen (opened while signed out): update it instead of stacking another.
    router.replace({ pathname: '/activites/[id]', params: { id: activityId, reminder: 'failed' } });
  }
}
