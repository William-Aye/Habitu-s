import { withEdgeCache } from "./_lib/edge.ts";
import { legalResponse } from "./_lib/legal.ts";

type Ctx = { request: Request; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 300, () => Promise.resolve(legalResponse("terms")));
