import { withEdgeCache } from "./_lib/edge.ts";
import { handleSitemapIndex } from "./_lib/pages.ts";
import type { Env } from "./_lib/pages.ts";

type Ctx = { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, env, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 3600, () => handleSitemapIndex(request, env));
