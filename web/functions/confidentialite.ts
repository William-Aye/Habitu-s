import { withEdgeCache } from "./_lib/edge.ts";
import { handleLegal } from "./_lib/pages.ts";

type Ctx = { request: Request; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 300, () => Promise.resolve(handleLegal("privacy")));
