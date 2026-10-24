// The interactive app under /app/: a single-page shell. No Cloudflare-only types: Deno can test it.
import { SECURITY_HEADERS } from "./pages.ts";

export interface SpaEnv {
  SUPABASE_URL?: string;
  ASSETS: { fetch: (input: Request | URL | string) => Promise<Response> };
}

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
  const connect = ["'self'", origin, ws].filter(Boolean).join(" ");
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
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  if (isAsset(url.pathname)) return env.ASSETS.fetch(request);

  const shell = await env.ASSETS.fetch(new URL("/app/", request.url));
  const headers = new Headers(shell.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.set("Content-Security-Policy", appCsp(env.SUPABASE_URL));
  headers.set("X-Robots-Tag", "noindex");
  headers.set("Cache-Control", "no-cache");
  return new Response(request.method === "HEAD" ? null : shell.body, { status: shell.status, headers });
}
