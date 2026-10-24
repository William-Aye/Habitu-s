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

export async function withEdgeCache(
  request: Request,
  ctx: Ctx,
  ttlSeconds: number,
  handler: () => Promise<Response>,
  cache: CacheLike | undefined = defaultCache(),
): Promise<Response> {
  if (!cache || request.method !== "GET") return handler();
  const url = new URL(request.url);
  url.search = "";
  const key = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
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
  return res;
}
