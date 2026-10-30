// The interactive app under /app/: a single-page shell. No Cloudflare-only types: Deno can test it.
import { SECURITY_HEADERS } from "./pages.ts";

export interface SpaEnv {
  SUPABASE_URL?: string;
  ASSETS: { fetch: (input: Request | URL | string) => Promise<Response> };
}

// Public APIs the app calls from the browser: commune lookup (geo.api.gouv.fr) and nearby public places (Overpass).
const APP_APIS = ["https://geo.api.gouv.fr", "https://overpass-api.de"];

/** The app shell may ask for the browser position ("près de moi"); public pages and assets may not. */
export const APP_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(self)";

/** CSP of /app/*, built from the Supabase URL (ws or wss follows its scheme). */
export function appCsp(supabaseUrl: string | undefined): string {
  let origin = "";
  let ws = "";
  try {
    const u = new URL(supabaseUrl ?? "");
    if (u.protocol === "https:" || u.protocol === "http:") {
      origin = u.origin;
      ws = `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
    }
  } catch { /* no backend source */ }
  const connect = ["'self'", origin, ws, ...APP_APIS].filter(Boolean).join(" ");
  const img = ["'self'", "data:", "blob:", origin].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    `connect-src ${connect}`,
    `img-src ${img}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const isAsset = (path: string) => {
  if (path.startsWith("/app/_expo/") || path.startsWith("/app/assets/")) return true;
  const last = path.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]+$/.test(last);
};

export async function handleApp(request: Request, env: SpaEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...SECURITY_HEADERS, Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const url = new URL(request.url);
  if (isAsset(url.pathname)) {
    // Pages may not apply `_headers` to what a Function returns, so set the security headers here (WEB-4).
    const asset = await env.ASSETS.fetch(request);
    const h = new Headers(asset.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
    return new Response(request.method === "HEAD" ? null : asset.body, { status: asset.status, statusText: asset.statusText, headers: h });
  }

  const shell = await env.ASSETS.fetch(new URL("/app/", request.url));
  const headers = new Headers(shell.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.set("Content-Security-Policy", appCsp(env.SUPABASE_URL));
  headers.set("Permissions-Policy", APP_PERMISSIONS_POLICY);
  headers.set("X-Robots-Tag", "noindex");
  headers.set("Cache-Control", "no-cache");
  return new Response(request.method === "HEAD" ? null : shell.body, { status: shell.status, headers });
}
