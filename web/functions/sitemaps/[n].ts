import { withEdgeCache } from "../../src/edge.ts";
import { defaultDeps, handleSitemap } from "../../src/pages.ts";
import type { Env } from "../../src/pages.ts";

type Ctx = { request: Request; env: Env; params: { n?: string | string[] }; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, env, params, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 3600, () =>
    handleSitemap(request, env, defaultDeps(env), String(Array.isArray(params.n) ? params.n[0] : params.n ?? "")));
