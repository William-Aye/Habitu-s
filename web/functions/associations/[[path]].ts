import { defaultDeps, handleAssociation } from "../_lib/pages.ts";
import type { Env } from "../_lib/pages.ts";

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) =>
  handleAssociation(request, env, defaultDeps(env));
