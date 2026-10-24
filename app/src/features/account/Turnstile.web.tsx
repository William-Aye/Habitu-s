import { useEffect, useRef } from 'react';
import { View } from 'react-native';

interface Props {
  siteKey?: string;
  /** Cloudflare widget action, when the server checks it (the feedback function wants `feedback`). */
  action?: string;
  onToken(token: string): void;
  onError(): void;
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** No token within this time (script blocked, offline) counts as a failure. */
const LOAD_TIMEOUT_MS = 15_000;

interface TurnstileApi {
  render(container: unknown, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}
const api = (): TurnstileApi | undefined => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

let loading: Promise<void> | null = null;
/** Adds Cloudflare's script once per page. The origin is allowed by the /app content security policy. */
function loadScript(): Promise<void> {
  if (api()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT_URL;
    el.async = true;
    el.onload = () => {
      loading = null;
      resolve();
    };
    el.onerror = () => {
      loading = null;
      reject(new Error('turnstile script'));
    };
    document.head.appendChild(el);
  });
  return loading;
}

/**
 * Cloudflare Turnstile in a div, same props and callbacks as the native component. Without a site
 * key (local development, where Supabase's CAPTCHA check is off) it yields an empty token.
 */
export function Turnstile({
  siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY,
  action,
  onToken,
  onError,
}: Props) {
  const cb = useRef({ onToken, onError });
  const host = useRef<unknown>(null);
  useEffect(() => {
    cb.current = { onToken, onError };
  });

  useEffect(() => {
    if (!siteKey) cb.current.onToken('');
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey) return;
    let active = true;
    let widget: string | undefined;
    const timer = setTimeout(() => cb.current.onError(), LOAD_TIMEOUT_MS);
    const done = (fn: () => void) => () => {
      clearTimeout(timer);
      if (active) fn();
    };
    loadScript().then(
      () => {
        const t = api();
        if (!active || !t || !host.current) return;
        widget = t.render(host.current, {
          sitekey: siteKey,
          ...(action ? { action } : {}),
          callback: (token: string) => done(() => cb.current.onToken(token))(),
          'error-callback': done(() => cb.current.onError()),
          'timeout-callback': done(() => cb.current.onError()),
        });
      },
      done(() => cb.current.onError()),
    );
    return () => {
      active = false;
      clearTimeout(timer);
      if (widget) {
        try {
          api()?.remove(widget);
        } catch {
          // The widget is already gone.
        }
      }
    };
  }, [siteKey, action]);

  if (!siteKey) return null;
  return <View ref={host as never} testID="turnstile-web" />;
}
