import { withEdgeCache } from "../src/edge.ts";
import { handleRobots } from "../src/pages.ts";
import type { Env } from "../src/pages.ts";

type Ctx = { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, env, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 3600, () => Promise.resolve(handleRobots(request, env)));
