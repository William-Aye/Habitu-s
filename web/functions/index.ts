import { handleHome } from "./_lib/pages.ts";
import type { Env } from "./_lib/pages.ts";

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => handleHome(request, env);
