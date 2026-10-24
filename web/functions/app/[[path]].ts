import { handleApp } from "../../src/spa.ts";
import type { SpaEnv } from "../../src/spa.ts";

type Ctx = { request: Request; env: SpaEnv };

export const onRequest = ({ request, env }: Ctx) => handleApp(request, env);
