import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { legalResponse, parseHeadersFile } from "./legal.ts";
import { PRIVACY_CONTACT } from "../../../app/src/content/contact.ts";

Deno.test("mentions légales: placeholders and hosts", async () => {
  const r = legalResponse("mentions");
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Content-Security-Policy")?.startsWith("default-src 'none'"), true);
  const t = await r.text();
  assertStringIncludes(t, "<title>Mentions légales · Habitués</title>");
  assertStringIncludes(t, "Éditeur : [NOM À COMPLÉTER]");
  assertStringIncludes(t, `Contact : ${PRIVACY_CONTACT.replace("<", "&lt;").replace(">", "&gt;")}`);
  assertStringIncludes(t, "Hébergeur : Cloudflare, Inc.");
  assertStringIncludes(t, "Supabase (région UE)");
  assertEquals(t.includes("<script"), false);
});

Deno.test("conditions: placeholder text", async () => {
  const r = legalResponse("terms");
  assertEquals(r.status, 200);
  const t = await r.text();
  assertStringIncludes(t, "<title>Conditions d&#39;utilisation · Habitués</title>");
  assertStringIncludes(t, "[À COMPLÉTER AVANT LANCEMENT]");
});

Deno.test("confidentialité: renders the privacy text", async () => {
  const r = legalResponse("privacy");
  assertEquals(r.status, 200);
  const t = await r.text();
  assertStringIncludes(t, "<title>Confidentialité · Habitués</title>");
  assertStringIncludes(t, "<h1>Politique de confidentialité</h1>");
  assertStringIncludes(t, "<h2>Ce que nous collectons</h2>");
  assertStringIncludes(t, "<li>Votre prénom");
  assertEquals(t.includes("${"), false);
  assertEquals(t.includes("<domaine>"), false); // escaped
});

Deno.test("_headers file: every required header and both CSPs", async () => {
  const text = await Deno.readTextFile(new URL("../../../web/public/_headers", import.meta.url));
  const blocks = parseHeadersFile(text);
  const all = blocks.get("/*")!;
  assertEquals(all["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assertEquals(all["X-Content-Type-Options"], "nosniff");
  assertEquals(all["X-Frame-Options"], "DENY");
  assertEquals(all["Referrer-Policy"], "strict-origin-when-cross-origin");
  assertEquals(all["Permissions-Policy"], "camera=(), microphone=(), geolocation=()");
  assertEquals(
    all["Content-Security-Policy"],
    "default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  const app = blocks.get("/app/*")!;
  const csp = app["Content-Security-Policy"];
  assertStringIncludes(csp, "default-src 'self'");
  assertStringIncludes(csp, "script-src 'self' https://challenges.cloudflare.com");
  assertStringIncludes(csp, "frame-src https://challenges.cloudflare.com");
  assertStringIncludes(csp, "connect-src 'self' {{SUPABASE_URL}} wss://{{SUPABASE_HOST}}");
  assertStringIncludes(csp, "img-src 'self' data: blob: {{SUPABASE_URL}}");
  assertStringIncludes(csp, "style-src 'self' 'unsafe-inline'");
  assertStringIncludes(csp, "font-src 'self' data:");
  assertStringIncludes(csp, "base-uri 'none'");
  assertStringIncludes(csp, "frame-ancestors 'none'");
  const origins = new Set(csp.match(/https?:\/\/[^\s;]+/g)!.filter((o) => !o.includes("{{")));
  assertEquals([...origins], ["https://challenges.cloudflare.com"]);
});
