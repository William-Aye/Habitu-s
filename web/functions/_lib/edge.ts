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
  const key = new Request(new URL(request.url).toString(), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await handler();
  if (CACHEABLE.has(res.status)) {
    const ttl = res.status === 404 || res.status === 410 ? Math.min(60, ttlSeconds) : ttlSeconds;
    const copy = new Response(res.clone().body, res);
    copy.headers.set("Cache-Control", `public, s-maxage=${ttl}`);
    ctx.waitUntil(cache.put(key, copy));
  }
  return res;
}
