import { defaultDeps, handleActivity } from "../_lib/pages.ts";
import type { Env } from "../_lib/pages.ts";

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) =>
  handleActivity(request, env, defaultDeps(env));
