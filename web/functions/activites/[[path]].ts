import { withEdgeCache } from "../../src/edge.ts";
import { defaultDeps, entityCacheOpts, handleActivity } from "../../src/pages.ts";
import type { Env } from "../../src/pages.ts";

type Ctx = { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, env, waitUntil }: Ctx) =>
  withEdgeCache(
    request,
    { waitUntil },
    300,
    () => handleActivity(request, env, defaultDeps(env), true),
    undefined,
    entityCacheOpts("/activites/", env, request),
  );
