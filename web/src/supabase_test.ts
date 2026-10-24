import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { makeRpc } from "./supabase.ts";

Deno.test("makeRpc posts to the rpc url with the apikey header and the signal", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = ((url: string, init: RequestInit) => {
    seen = { url, init };
    return Promise.resolve(new Response(JSON.stringify({ a: 1 }), { status: 200 }));
  }) as unknown as typeof fetch;
  const ac = new AbortController();
  const rpc = makeRpc({ SUPABASE_URL: "http://sb/", SUPABASE_ANON_KEY: "KEY" }, f);
  assertEquals(await rpc("web_activity_page", { p_id: "x" }, ac.signal), { a: 1 });
  assertEquals(seen!.url, "http://sb/rest/v1/rpc/web_activity_page");
  assertEquals((seen!.init.headers as Record<string, string>).apikey, "KEY");
  assertEquals(seen!.init.method, "POST");
  assertEquals(seen!.init.body, JSON.stringify({ p_id: "x" }));
  assertEquals(seen!.init.signal, ac.signal);
});

Deno.test("makeRpc throws on non-OK without leaking the body", async () => {
  const f = (() => Promise.resolve(new Response("secret detail", { status: 500 }))) as unknown as typeof fetch;
  const rpc = makeRpc({ SUPABASE_URL: "http://sb", SUPABASE_ANON_KEY: "k" }, f);
  const e = await assertRejects(() => rpc("x"));
  assertEquals((e as Error).message.includes("secret"), false);
  assertEquals((e as { code?: string }).code, "http_500");
});
