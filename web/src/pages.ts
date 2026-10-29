// Request handlers for the public pages. No Cloudflare-only APIs: Deno can test them.
import {
  DEFAULT_PLAY_STORE,
  escapeHtml,
  renderActivityPage,
  renderAssociationPage,
  renderHome,
  renderNotFound,
  renderUnavailable,
} from "./html.ts";
import type { RenderOpts } from "./html.ts";
import { activityPath, associationPath, parseSlugId } from "./slug.ts";
import { makeRpc } from "./supabase.ts";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WEB_BASE_URL?: string;
  PLAY_STORE_URL?: string;
  ANDROID_PACKAGE?: string;
}

export interface Deps {
  rpc: (name: string, args?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
  /** One deadline per request, in milliseconds (default 5000). */
  timeoutMs?: number;
}

/** Sitemap buckets: ids are random v4 uuids, so the first bits split them evenly. Must match web_sitemap_range. */
export const ASSOCIATION_BUCKETS = 256; // first 8 bits (about 6k rows per file at 1.5M)
export const ACTIVITY_BUCKETS = 16; // first 4 bits

export function defaultDeps(env: Env): Deps {
  return { rpc: makeRpc(env) };
}

/** WEB_BASE_URL, else the origin of the request. */
export const baseUrl = (env: Env, req: Request) =>
  (env.WEB_BASE_URL || new URL(req.url).origin).replace(/\/+$/, "");

const renderOpts = (env: Env): RenderOpts => ({
  playStore: env.PLAY_STORE_URL || DEFAULT_PLAY_STORE,
  androidPackage: env.ANDROID_PACKAGE || undefined,
});

const PUBLIC_CSP =
  "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": PUBLIC_CSP,
};

const CACHE_OK = "public, s-maxage=300, max-age=60";
const CACHE_GONE = "public, s-maxage=60";
const CACHE_LONG = "public, s-maxage=3600";

function respond(body: string | null, status: number, type: string, extra: Record<string, string> = {}): Response {
  const headers = new Headers({ ...SECURITY_HEADERS, ...extra });
  if (type) headers.set("Content-Type", type);
  return new Response(body, { status, headers });
}
const HTML = "text/html; charset=utf-8";

const html = (body: string, status = 200, cache = CACHE_OK) => respond(body, status, HTML, { "Cache-Control": cache });
const gone = (status: 404 | 410) => html(renderNotFound(status), status, CACHE_GONE);
const unavailable = () =>
  respond(renderUnavailable(), 503, HTML, { "Retry-After": "60", "Cache-Control": "no-store" });
const redirect = (to: string) => respond(null, 301, "", { Location: to, "Cache-Control": CACHE_OK });

class DeadlineError extends Error {
  override name = "DeadlineError";
}

/** Failure log: route, rpc name and an error code only. Never a URL, an IP or an error message. */
function logFailure(route: string, rpc: string, e: unknown) {
  const raw = (e as { code?: unknown })?.code;
  const code = typeof raw === "string" ? raw : e instanceof DeadlineError ? "timeout" : "error";
  console.error(JSON.stringify({ route, rpc, code }));
}

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** One deadline for the whole request: its signal is passed to every RPC. */
async function withDeadline<T>(deps: Deps, fn: (rpc: Rpc) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? 5000);
  const aborted = new Promise<never>((_, rej) => {
    ac.signal.addEventListener("abort", () => rej(new DeadlineError("deadline")), { once: true });
  });
  aborted.catch(() => {});
  try {
    return await Promise.race([fn((name, args) => deps.rpc(name, args, ac.signal)), aborted]);
  } finally {
    clearTimeout(timer);
  }
}

function segmentAfter(req: Request, prefix: string): string | null {
  const p = new URL(req.url).pathname;
  if (!p.startsWith(prefix)) return null;
  const rest = p.slice(prefix.length).replace(/\/+$/, "");
  if (rest === "" || rest.includes("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
type Json = any;

async function handleEntity(
  req: Request,
  env: Env,
  deps: Deps,
  cfg: {
    route: string;
    prefix: string;
    rpcName: string;
    field: string;
    path: (x: Json) => string;
    render: (x: Json, base: string, opts: RenderOpts) => string;
  },
): Promise<Response> {
  const seg = segmentAfter(req, cfg.prefix);
  if (seg === null) return gone(404);
  const { id } = parseSlugId(seg);
  if (!id) return gone(404);
  try {
    const page = (await withDeadline(deps, (rpc) => rpc(cfg.rpcName, { p_id: id }))) as Json;
    const status = page?.status;
    if (status === "ok") {
      const x = page[cfg.field];
      if (!x || typeof x !== "object") return gone(404);
      const canonical = cfg.path(x);
      const base = baseUrl(env, req);
      if (new URL(req.url).pathname !== canonical) return redirect(base + canonical);
      return html(cfg.render(x, base, renderOpts(env)));
    }
    return gone(status === "removed" ? 410 : 404);
  } catch (e) {
    logFailure(cfg.route, cfg.rpcName, e);
    return unavailable();
  }
}

export function handleActivity(req: Request, env: Env, deps: Deps): Promise<Response> {
  return handleEntity(req, env, deps, {
    route: "activity",
    prefix: "/activites/",
    rpcName: "web_activity_page",
    field: "activity",
    path: (a) => activityPath(a.id, a.title ?? ""),
    render: renderActivityPage,
  });
}

export function handleAssociation(req: Request, env: Env, deps: Deps): Promise<Response> {
  return handleEntity(req, env, deps, {
    route: "association",
    prefix: "/associations/",
    rpcName: "web_association_page",
    field: "association",
    path: (x) => associationPath(x.id, x.name ?? "", x.city),
    render: renderAssociationPage,
  });
}

// ---- sitemaps ----

const KINDS = {
  a: { kind: "activities", buckets: ACTIVITY_BUCKETS, path: (r: Json) => activityPath(r.id, r.title ?? "") },
  s: {
    kind: "associations",
    buckets: ASSOCIATION_BUCKETS,
    path: (r: Json) => associationPath(r.id, r.name ?? "", r.city),
  },
} as const;
type Kind = keyof typeof KINDS;

const XML = "application/xml; charset=utf-8";
const xmlEsc = escapeHtml;

/** Static: lists every bucket, makes no database call. */
export function handleSitemapIndex(req: Request, env: Env, _deps?: Deps): Promise<Response> {
  const base = baseUrl(env, req);
  const entries: string[] = [];
  for (const k of ["a", "s"] as Kind[]) {
    for (let n = 0; n < KINDS[k].buckets; n++) {
      entries.push(`<sitemap><loc>${xmlEsc(`${base}/sitemaps/${k}-${n}.xml`)}</loc></sitemap>`);
    }
  }
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`;
  return Promise.resolve(respond(body, 200, XML, { "Cache-Control": CACHE_LONG }));
}

/** `file` is the last path segment, e.g. "s-3.xml". One RPC per file. */
export async function handleSitemap(req: Request, env: Env, deps: Deps, file: string): Promise<Response> {
  const m = /^([as])-(0|[1-9][0-9]{0,2})\.xml$/.exec(file);
  if (!m) return gone(404);
  const k = KINDS[m[1] as Kind];
  const bucket = Number(m[2]);
  if (bucket >= k.buckets) return gone(404);
  try {
    // The database computes the bucket's id range itself and refuses any other bucket (WEB-2).
    const rows = (await withDeadline(deps, (rpc) =>
      rpc("web_sitemap_range", { p_kind: k.kind, p_bucket: bucket }))) as Json[] | null;
    const base = baseUrl(env, req);
    const urls = (Array.isArray(rows) ? rows : []).map((r) => {
      const last = r.updated_at ? new Date(r.updated_at).toISOString() : null;
      return `<url><loc>${xmlEsc(base + k.path(r))}</loc>${last ? `<lastmod>${last}</lastmod>` : ""}</url>`;
    });
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
    return respond(body, 200, XML, { "Cache-Control": CACHE_LONG });
  } catch (e) {
    logFailure("sitemap", "web_sitemap_range", e);
    return unavailable();
  }
}

// ---- static ----

export function handleRobots(req: Request, env: Env): Response {
  const body = `User-agent: *\nAllow: /\nDisallow: /app/\n\nSitemap: ${baseUrl(env, req)}/sitemap.xml\n`;
  return respond(body, 200, "text/plain; charset=utf-8", { "Cache-Control": CACHE_LONG });
}

export function handleHome(req: Request, env: Env): Response {
  return html(renderHome(baseUrl(env, req), env.PLAY_STORE_URL || DEFAULT_PLAY_STORE));
}

/** HEAD / : 200 with the headers only, no rendering. */
export function handleHomeHead(): Response {
  return respond(null, 200, HTML, { "Cache-Control": CACHE_OK });
}
