import { withEdgeCache } from "../src/edge.ts";
import { legalResponse } from "../src/legal.ts";

type Ctx = { request: Request; waitUntil: (p: Promise<unknown>) => void };

export const onRequestGet = ({ request, waitUntil }: Ctx) =>
  withEdgeCache(request, { waitUntil }, 300, () => Promise.resolve(legalResponse("terms")));
