import { defaultDeps, handleSitemap } from "../_lib/pages.ts";
import type { Env } from "../_lib/pages.ts";

export const onRequestGet = ({ request, env, params }: { request: Request; env: Env; params: { n?: string | string[] } }) =>
  handleSitemap(request, env, defaultDeps(env), String(Array.isArray(params.n) ? params.n[0] : params.n ?? ""));
