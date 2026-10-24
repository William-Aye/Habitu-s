import { withEdgeCache } from "../src/edge.ts";
import { handleHome, handleHomeHead } from "../src/pages.ts";
import type { Env } from "../src/pages.ts";

type Ctx = { request: Request; env: Env; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, env, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 300, () => Promise.resolve(handleHome(request, env)));

// Uptime checks and link previewers send HEAD /: answer 200 without rendering.
export const onRequestHead = () => handleHomeHead();
