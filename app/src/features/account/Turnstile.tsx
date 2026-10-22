import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';

interface Props {
  siteKey?: string;
  onToken(token: string): void;
  onError(): void;
}

const BASE_URL = 'https://challenges.cloudflare.com';
/** No token within this time (script blocked, offline) counts as a failure. */
const LOAD_TIMEOUT_MS = 15_000;

// Invisible mode is a property of the site key (widget type "Invisible" in the Cloudflare
// dashboard), not a render option, so none is passed to render(). The hostname the WebView
// loads from (BASE_URL's page, i.e. the baseUrl below) must be allowed for that site key.
function html(siteKey: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width">
<script src="${BASE_URL}/turnstile/v0/api.js?render=explicit" async defer></script></head>
<body><div id="w"></div><script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var t=setInterval(function(){
  if(window.turnstile){clearInterval(t);
    window.turnstile.render('#w',{sitekey:${JSON.stringify(siteKey)},
      callback:function(k){post({token:k});},
      'error-callback':function(){post({error:true});},
      'timeout-callback':function(){post({error:true});}});
  }
},100);
</script></body></html>`;
}

/**
 * Invisible Cloudflare Turnstile challenge in a 0-size WebView. Without a site key
 * (local development, where Supabase's CAPTCHA check is off) it yields an empty token.
 */
export function Turnstile({
  siteKey = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY,
  onToken,
  onError,
}: Props) {
  const cb = useRef({ onToken, onError });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    cb.current = { onToken, onError };
  });

  useEffect(() => {
    if (!siteKey) cb.current.onToken('');
  }, [siteKey]);

  useEffect(() => {
    if (!siteKey) return;
    timer.current = setTimeout(() => cb.current.onError(), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer.current);
  }, [siteKey]);

  if (!siteKey) return null;
  return (
    <WebView
      style={{ width: 0, height: 0, opacity: 0 }}
      originWhitelist={[BASE_URL, 'about:blank']}
      source={{ html: html(siteKey), baseUrl: BASE_URL }}
      javaScriptEnabled
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onError={() => {
        clearTimeout(timer.current);
        cb.current.onError();
      }}
      onMessage={(e) => {
        try {
          const m = JSON.parse(e.nativeEvent.data) as { token?: string; error?: boolean };
          if (m.token) {
            clearTimeout(timer.current);
            cb.current.onToken(m.token);
          } else if (m.error) {
            clearTimeout(timer.current);
            cb.current.onError();
          }
        } catch {
          cb.current.onError();
        }
      }}
    />
  );
}
