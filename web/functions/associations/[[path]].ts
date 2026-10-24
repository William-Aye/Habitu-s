import { withEdgeCache } from "../../src/edge.ts";
import { defaultDeps, handleAssociation } from "../../src/pages.ts";
import type { Env } from "../../src/pages.ts";

type Ctx = { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, env, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 300, () => handleAssociation(request, env, defaultDeps(env)));
