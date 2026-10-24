import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import * as Device from 'expo-device';
import { supabase } from '../../lib/supabase';
import { reencodeJpeg } from '../account/avatar';

export type FeedbackType = 'idea' | 'problem' | 'other';
export const MAX_FEEDBACK = 5000;
const SCREENSHOT_WIDTH = 1280;

export type FeedbackError = 'limit_reached' | 'captcha' | 'network' | 'unknown';
export type FeedbackResult = { ok: true } | { ok: false; error: FeedbackError };

export interface FeedbackInput {
  type: FeedbackType;
  body: string;
  /** Signed-in senders only. */
  screenshotUri?: string;
  screenshotWidth?: number;
  /** Signed-out senders only: the Turnstile token (widget action `feedback`). */
  turnstileToken?: string;
}

/**
 * Signed in: inserts directly (the screenshot, re-encoded on the phone so it carries no EXIF, goes to the
 * private bucket first). Signed out: goes through the `submit-feedback` function, which checks Turnstile.
 */
export async function sendFeedback(input: FeedbackInput): Promise<FeedbackResult> {
  const body = input.body.trim();
  const appVersion = Constants.expoConfig?.version ?? null;
  const deviceModel = Device.modelName ?? null;
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id;
    if (!userId) {
      const { error } = await supabase.functions.invoke('submit-feedback', {
        body: {
          type: input.type,
          body,
          app_version: appVersion,
          device_model: deviceModel,
          turnstile_token: input.turnstileToken ?? '',
        },
      });
      if (!error) return { ok: true };
      const status = (error as { context?: { status?: number } }).context?.status;
      if (status === 429) return { ok: false, error: 'limit_reached' };
      if (status === 403) return { ok: false, error: 'captcha' };
      return { ok: false, error: status ? 'unknown' : 'network' };
    }

    let screenshotPath: string | null = null;
    if (input.screenshotUri) {
      const file = await reencodeJpeg(input.screenshotUri, input.screenshotWidth, SCREENSHOT_WIDTH);
      const path = `${userId}/${randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from('feedback-screenshots')
        .upload(path, await file.arrayBuffer(), { contentType: 'image/jpeg' });
      if (error) return { ok: false, error: 'network' };
      screenshotPath = path;
    }
    const { error } = await supabase.from('feedback').insert({
      type: input.type,
      body,
      app_version: appVersion,
      device_model: deviceModel,
      screenshot_path: screenshotPath,
      source: 'app',
    });
    if (!error) return { ok: true };
    if (error.code === '42501' && (error.message ?? '').includes('limit_reached')) {
      return { ok: false, error: 'limit_reached' };
    }
    return { ok: false, error: error.code ? 'unknown' : 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}
