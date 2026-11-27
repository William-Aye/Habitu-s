import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { legalResponse, parseHeadersFile, renderLegalPage } from "./legal.ts";
import { PRIVACY_CONTACT } from "../../app/src/content/contact.ts";

Deno.test("mentions légales: placeholders and hosts", async () => {
  const r = legalResponse("mentions");
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("Content-Security-Policy")?.startsWith("default-src 'none'"), true);
  const t = await r.text();
  assertStringIncludes(t, "<title>Mentions légales · Habituer</title>");
  assertStringIncludes(t, "Éditeur : [NOM À COMPLÉTER]");
  assertStringIncludes(t, `Contact : ${PRIVACY_CONTACT.replace("<", "&lt;").replace(">", "&gt;")}`);
  assertStringIncludes(t, "Hébergeur : Cloudflare, Inc.");
  assertStringIncludes(t, "Supabase (région UE)");
  assertStringIncludes(t, "101 Townsend Street, San Francisco, CA 94107");
  assertStringIncludes(t, "Hébergeur : Cloudflare, Inc.");
  assertStringIncludes(t, "Téléphone de l&#39;hébergeur : [À COMPLÉTER]");
  assertStringIncludes(t, "Supabase : société [À COMPLÉTER], adresse [À COMPLÉTER], téléphone [À COMPLÉTER]");
  assertEquals(t.includes("<script"), false);
});

Deno.test("conditions: the terms of use, complete and without placeholder", async () => {
  const r = legalResponse("terms");
  assertEquals(r.status, 200);
  const t = await r.text();
  assertStringIncludes(t, "<title>Conditions d&#39;utilisation · Habituer</title>");
  assertStringIncludes(t, "<h1>Conditions d&#39;utilisation</h1>");
  for (const h of [
    "Objet",
    "Accès au service",
    "Règles de conduite",
    "Contenus des utilisateurs",
    "Signalement et modération",
    "Suspension et suppression du compte",
    "Responsabilité",
    "Données personnelles",
    "Modification des conditions",
    "Droit applicable",
  ]) {
    assertStringIncludes(t, `<h2>${h}</h2>`);
  }
  assertStringIncludes(t, "18 ans ou plus");
  assertStringIncludes(t, "lieu public");
  assertStringIncludes(t, "exposé des motifs");
  assertStringIncludes(t, "confidentialite@&lt;domaine&gt;"); // the contest address
  assertEquals(/à compléter/i.test(t), false);
  assertEquals(t.includes("${"), false);
  assertEquals(t.includes("<script"), false);
});

Deno.test("confidentialité: renders the privacy text", async () => {
  const r = legalResponse("privacy");
  assertEquals(r.status, 200);
  const t = await r.text();
  assertStringIncludes(t, "<title>Confidentialité · Habituer</title>");
  assertStringIncludes(t, "<h1>Politique de confidentialité</h1>");
  assertStringIncludes(t, "<h2>Ce que nous collectons</h2>");
  assertStringIncludes(t, "<li>Votre prénom");
  assertEquals(t.includes("${"), false);
  assertEquals(t.includes("<domaine>"), false); // escaped
});

Deno.test("_headers file: every required header and the public CSP", async () => {
  const text = await Deno.readTextFile(new URL("../public/_headers", import.meta.url));
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
  assertEquals(blocks.has("/app/*"), false); // the /app CSP is built at runtime (spa.ts)
});

Deno.test("legal pages share the header logo and the icons with the other pages", () => {
  for (const kind of ["mentions", "terms", "privacy"] as const) {
    const t = renderLegalPage(kind);
    assertStringIncludes(t, '<svg class="logo"');
    assertStringIncludes(t, '<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    assertStringIncludes(t, '<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  }
});

Deno.test("conditions: activities with children", async () => {
  const t = await legalResponse("terms").text();
  assertStringIncludes(t, "sous la seule responsabilité de leur parent");
  assertStringIncludes(t, "ne vérifie ni l&#39;identité des membres ni leurs antécédents judiciaires");
  assertStringIncludes(t, "comportement inquiétant envers des enfants");
});
