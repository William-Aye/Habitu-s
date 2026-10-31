// Edge cache helper around the Cloudflare Cache API. No Cloudflare types: the cache is injectable.
export interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}
export interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

const CACHEABLE = new Set([200, 301, 404, 410]);

// deno-lint-ignore no-explicit-any
const defaultCache = (): CacheLike | undefined => (globalThis as any).caches?.default;

export interface EdgeOpts {
  /**
   * Cache key for this URL (WEB-1): the canonical form, so path variants share one entry.
   * Return null for a URL that must never touch the cache (it is answered without a lookup).
   * Default: the path without the query string.
   */
  key?: (url: URL) => string | null;
  /** Applied to every response leaving the helper, hit or miss, after the copy is stored. */
  resolve?: (res: Response) => Response;
}

export async function withEdgeCache(
  request: Request,
  ctx: Ctx,
  ttlSeconds: number,
  handler: () => Promise<Response>,
  cache: CacheLike | undefined = defaultCache(),
  opts: EdgeOpts = {},
): Promise<Response> {
  const resolve = opts.resolve ?? ((r: Response) => r);
  if (!cache || request.method !== "GET") return resolve(await handler());
  const url = new URL(request.url);
  url.search = "";
  const keyUrl = opts.key ? opts.key(url) : url.toString();
  if (keyUrl === null) return resolve(await handler());
  const key = new Request(keyUrl, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return resolve(hit);
  const res = await handler();
  if (CACHEABLE.has(res.status)) {
    const ttl = res.status === 404 || res.status === 410 ? Math.min(60, ttlSeconds) : ttlSeconds;
    const copy = new Response(res.clone().body, res);
    // Keep the original directives (max-age for browsers), set s-maxage for the edge.
    const kept = (res.headers.get("Cache-Control") ?? "")
      .split(",").map((d) => d.trim()).filter((d) => d && !/^s-maxage=/i.test(d));
    if (!kept.some((d) => d.toLowerCase() === "public")) kept.unshift("public");
    copy.headers.set("Cache-Control", [...kept, `s-maxage=${ttl}`].join(", "));
    ctx.waitUntil(cache.put(key, copy));
  }
  return resolve(res);
}
