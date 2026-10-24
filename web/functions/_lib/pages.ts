// Request handlers for the public pages. No Cloudflare-only APIs: Deno can test them.
import { copy } from "./copy.ts";
import {
  DEFAULT_PLAY_STORE,
  escapeHtml,
  renderActivityPage,
  renderAssociationPage,
  renderHome,
  renderLegal,
  renderNotFound,
  renderUnavailable,
} from "./html.ts";
import { activityPath, associationPath, parseSlugId } from "./slug.ts";
import { makeRpc } from "./supabase.ts";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WEB_BASE_URL?: string;
  PLAY_STORE_URL?: string;
}

export interface Deps {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  /** Per-call timeout in milliseconds (default 5000). */
  timeoutMs?: number;
}

export const SITEMAP_PAGE = 50000;
const DEFAULT_BASE = "https://habitues.pages.dev";

export function defaultDeps(env: Env): Deps {
  return { rpc: makeRpc(env) };
}

export const baseUrl = (env: Env) => (env.WEB_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
const playStore = (env: Env) => env.PLAY_STORE_URL || DEFAULT_PLAY_STORE;

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

class Timeout extends Error {}

async function call(deps: Deps, name: string, args: Record<string, unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Timeout("timeout")), deps.timeoutMs ?? 5000);
  });
  try {
    return await Promise.race([deps.rpc(name, args), timeout]);
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
    prefix: string;
    statusFn: string;
    getFn: string;
    removed: (s: string) => boolean;
    path: (x: Json) => string;
    render: (x: Json, base: string, store: string) => string;
  },
): Promise<Response> {
  const seg = segmentAfter(req, cfg.prefix);
  if (seg === null) return gone(404);
  const { id } = parseSlugId(seg);
  if (!id) return gone(404);
  try {
    const status = await call(deps, cfg.statusFn, { p_id: id });
    if (status === "ok") {
      const x = await call(deps, cfg.getFn, { p_id: id });
      if (!x || typeof x !== "object") return gone(404);
      const canonical = cfg.path(x);
      if (new URL(req.url).pathname !== canonical) return redirect(baseUrl(env) + canonical);
      return html(cfg.render(x, baseUrl(env), playStore(env)));
    }
    return gone(typeof status === "string" && cfg.removed(status) ? 410 : 404);
  } catch {
    return unavailable();
  }
}

export function handleActivity(req: Request, env: Env, deps: Deps): Promise<Response> {
  return handleEntity(req, env, deps, {
    prefix: "/activites/",
    statusFn: "web_activity_status",
    getFn: "get_activity",
    removed: (s) => s === "removed",
    path: (a) => activityPath(a.id, a.title ?? ""),
    render: renderActivityPage,
  });
}

export function handleAssociation(req: Request, env: Env, deps: Deps): Promise<Response> {
  return handleEntity(req, env, deps, {
    prefix: "/associations/",
    statusFn: "web_association_status",
    getFn: "get_association",
    removed: (s) => s === "removed",
    path: (x) => associationPath(x.id, x.name ?? "", x.city),
    render: renderAssociationPage,
  });
}

// ---- sitemaps ----

const KINDS = {
  a: {
    fn: "web_sitemap_activities",
    path: (r: Json) => activityPath(r.id, r.title ?? ""),
  },
  s: {
    fn: "web_sitemap_associations",
    path: (r: Json) => associationPath(r.id, r.name ?? "", r.city),
  },
} as const;
type Kind = keyof typeof KINDS;

/** Walk the keyset to the end. The server may cap a page (PostgREST max_rows), so stop on an empty page. */
async function walk(deps: Deps, fn: string, onRows: (rows: Json[]) => void): Promise<void> {
  let after: string | null = null;
  for (;;) {
    const rows = (await call(deps, fn, { p_after: after, p_limit: SITEMAP_PAGE })) as Json[] | null;
    if (!Array.isArray(rows) || rows.length === 0) return;
    onRows(rows);
    after = rows[rows.length - 1].id;
  }
}

const XML = "application/xml; charset=utf-8";
const xmlEsc = escapeHtml;

export async function handleSitemapIndex(_req: Request, env: Env, deps: Deps): Promise<Response> {
  try {
    const base = baseUrl(env);
    const entries: string[] = [];
    for (const k of ["a", "s"] as Kind[]) {
      let total = 0;
      await walk(deps, KINDS[k].fn, (rows) => (total += rows.length));
      for (let n = 1; n <= Math.ceil(total / SITEMAP_PAGE); n++) {
        entries.push(`<sitemap><loc>${xmlEsc(`${base}/sitemaps/${k}-${n}.xml`)}</loc></sitemap>`);
      }
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`;
    return respond(body, 200, XML, { "Cache-Control": CACHE_LONG });
  } catch {
    return unavailable();
  }
}

/** `file` is the last path segment, e.g. "s-3.xml". */
export async function handleSitemap(_req: Request, env: Env, deps: Deps, file: string): Promise<Response> {
  const m = /^([as])-([1-9][0-9]{0,5})\.xml$/.exec(file);
  if (!m) return gone(404);
  const kind = m[1] as Kind;
  const n = Number(m[2]);
  const from = (n - 1) * SITEMAP_PAGE;
  const to = n * SITEMAP_PAGE;
  try {
    const base = baseUrl(env);
    const urls: string[] = [];
    let seen = 0;
    await walk(deps, KINDS[kind].fn, (rows) => {
      for (const r of rows) {
        if (seen >= from && seen < to) {
          const last = r.updated_at ? new Date(r.updated_at).toISOString() : null;
          urls.push(`<url><loc>${xmlEsc(base + KINDS[kind].path(r))}</loc>${last ? `<lastmod>${last}</lastmod>` : ""}</url>`);
        }
        seen++;
      }
    });
    if (urls.length === 0) return gone(404);
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
    return respond(body, 200, XML, { "Cache-Control": CACHE_LONG });
  } catch {
    return unavailable();
  }
}

// ---- static ----

export function handleRobots(_req: Request, env: Env): Response {
  const body = `User-agent: *\nAllow: /\nDisallow: /app/\n\nSitemap: ${baseUrl(env)}/sitemap.xml\n`;
  return respond(body, 200, "text/plain; charset=utf-8", { "Cache-Control": CACHE_LONG });
}

export function handleHome(_req: Request, env: Env): Response {
  return html(renderHome(baseUrl(env), playStore(env)));
}

export function handleLegal(kind: "mentions" | "terms" | "privacy"): Response {
  return html(renderLegal(copy.legal[kind]));
}
