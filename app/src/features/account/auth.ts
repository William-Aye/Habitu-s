import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { supabase } from '../../lib/supabase';

export type AuthError =
  | 'captcha'
  | 'network'
  | 'invalid_code'
  | 'expired_code'
  | 'rate_limited'
  | 'cancelled'
  | 'unknown';

type Ok = { ok: true };
type Fail<E extends string = AuthError> = { ok: false; error: E };

export const MAX_FIRST_NAME = 40;

/** Maps a Supabase (or fetch) failure to a stable code the UI can translate. */
export function mapAuthError(error: unknown): AuthError {
  if (!error || typeof error !== 'object') return 'unknown';
  const e = error as { status?: number; name?: string; message?: string; code?: string };
  const message = String(e.message ?? '').toLowerCase();
  if (e.status === 429 || e.code === 'over_email_send_rate_limit') return 'rate_limited';
  if (message.includes('captcha')) return 'captcha';
  if (
    e.name === 'AuthRetryableFetchError' ||
    message.includes('failed to fetch') ||
    message.includes('network request failed')
  ) {
    return 'network';
  }
  if (message.includes('expired')) return 'expired_code';
  if (message.includes('invalid') || message.includes('token')) return 'invalid_code';
  return 'unknown';
}

/** For calls that involve no one-time code: only network, rate-limit and cancel are meaningful. */
function mapGeneralError(error: unknown): AuthError {
  const mapped = mapAuthError(error);
  return mapped === 'network' || mapped === 'rate_limited' || mapped === 'cancelled'
    ? mapped
    : 'unknown';
}

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID });
  googleConfigured = true;
}

export async function signInWithGoogle(): Promise<
  { ok: true; givenName?: string } | Fail
> {
  try {
    configureGoogle();
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return { ok: false, error: 'cancelled' };
    const idToken = res.data.idToken;
    if (!idToken) return { ok: false, error: 'unknown' };
    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { ok: false, error: mapGeneralError(error) };
    const givenName = res.data.user?.givenName?.trim();
    return givenName ? { ok: true, givenName } : { ok: true };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'SIGN_IN_CANCELLED') return { ok: false, error: 'cancelled' };
    return { ok: false, error: mapGeneralError(error) };
  }
}

export async function sendEmailCode(email: string, captchaToken: string): Promise<Ok | Fail> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, captchaToken },
    });
    return error ? { ok: false, error: mapAuthError(error) } : { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<Ok | Fail> {
  try {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
    return error ? { ok: false, error: mapAuthError(error) } : { ok: true };
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
}

export interface HomeAreaInput {
  lon: number;
  lat: number;
  label: string;
}

export async function completeProfile(input: {
  firstName: string;
  ageConfirmed: true;
  language: 'fr' | 'en';
  homeArea?: HomeAreaInput | null;
}): Promise<Ok | Fail<'first_name' | 'age' | AuthError>> {
  const firstName = input.firstName.trim();
  if (firstName.length === 0 || firstName.length > MAX_FIRST_NAME) {
    return { ok: false, error: 'first_name' };
  }
  if (input.ageConfirmed !== true) return { ok: false, error: 'age' };
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return { ok: false, error: 'unknown' };
    const patch: {
      first_name: string;
      age_confirmed: boolean;
      language: string;
      home_area?: string;
      home_area_label?: string;
    } = {
      first_name: firstName,
      age_confirmed: true,
      language: input.language,
    };
    if (input.homeArea) {
      patch.home_area = `SRID=4326;POINT(${input.homeArea.lon} ${input.homeArea.lat})`;
      patch.home_area_label = input.homeArea.label;
    }
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    return error ? { ok: false, error: mapGeneralError(error) } : { ok: true };
  } catch (error) {
    return { ok: false, error: mapGeneralError(error) };
  }
}

export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Not signed in with Google, or the module is unavailable: nothing to do.
  }
  try {
    await supabase.auth.signOut();
  } catch {
    // Local session is cleared by the next launch check; nothing more to do here.
  }
}
