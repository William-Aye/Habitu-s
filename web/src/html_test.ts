import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { escapeHtml, formatParisDate, jsonLd, renderActivityPage, renderAssociationPage, renderNotFound, renderUnavailable } from "./html.ts";
import { activityFixture, associationFixture, EVIL } from "./fixtures.ts";

const BASE = "https://habitues.test";

Deno.test("escapeHtml escapes the five characters", () => {
  assertEquals(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});

Deno.test("jsonLd never contains a raw <", () => {
  const out = jsonLd({ name: EVIL });
  assert(!out.includes("<"));
  assert(!out.toLowerCase().includes("</script"));
  assertStringIncludes(out, "\\u003c");
  assertEquals(JSON.parse(out).name, EVIL);
});

Deno.test("formatParisDate uses Europe/Paris", () => {
  assertEquals(formatParisDate("2026-10-27T18:00:00Z"), "mardi 27 octobre à 19:00");
  assertEquals(formatParisDate("2026-07-14T10:30:00Z"), "mardi 14 juillet à 12:30");
});

Deno.test("evil title is escaped in title, OG and body, and the JSON-LD stays inert", () => {
  const html = renderActivityPage(activityFixture({ title: EVIL, description: EVIL }), BASE);
  assert(!html.includes("<script>alert(1)"));
  assertStringIncludes(html, "&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;");
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(ld);
  assert(!ld[1].includes("<"));
  assertEquals(JSON.parse(ld[1]).name, EVIL);
  // exactly one script element, the JSON-LD
  assertEquals((html.match(/<script/g) ?? []).length, 1);
  assertEquals(/<[^>]*\sstyle=/.test(html), false);
});

Deno.test("activity page content", () => {
  const html = renderActivityPage(activityFixture(), BASE);
  assertStringIncludes(html, "<title>Jeu de go · Habitués</title>");
  assertStringIncludes(html, `<link rel="canonical" href="${BASE}/activites/jeu-de-go-11111111-1111-4111-8111-111111111111">`);
  for (const k of ["og:title", "og:description", "og:url", "og:image", "og:type", "og:locale"]) {
    assertStringIncludes(html, `property="${k}"`);
  }
  assertStringIncludes(html, `content="${BASE}/og-default.png"`);
  assertStringIncludes(html, 'content="fr_FR"');
  assertStringIncludes(html, 'name="twitter:card" content="summary"');
  assertStringIncludes(html, "Prochaine séance : mardi 27 octobre à 19:00");
  assertStringIncludes(html, "3 confirmés");
  assertStringIncludes(html, "Organisé par Camille");
  assertStringIncludes(html, "Je serai là");
  assertStringIncludes(html, 'href="/app/activites/11111111-1111-4111-8111-111111111111"');
  assertStringIncludes(html, "Ouvrir dans l&#39;application");
  assertStringIncludes(html, "Télécharger l&#39;application");
  assertStringIncludes(html, "Voir sur la carte");
  assertStringIncludes(html, "https://www.openstreetmap.org/?mlat=45.764&amp;mlon=4.8357#map=17/45.764/4.8357");
  assertStringIncludes(html, '"@type":"Event"');
  assertStringIncludes(html, '"startDate":"2026-10-27T18:00:00.000Z"');
  assert(!html.includes("Alice"));
  assert(!html.includes("Bob"));
});

Deno.test("meta description is the first 155 characters", () => {
  const html = renderActivityPage(activityFixture({ description: "x".repeat(400) }), BASE);
  assertStringIncludes(html, `<meta name="description" content="${"x".repeat(155)}">`);
});

Deno.test("organiser name falls back to the association", () => {
  const html = renderActivityPage(activityFixture({ organised_by: { kind: "association", id: "a", name: "Les Joueurs" } }), BASE);
  assertStringIncludes(html, "Organisé par Les Joueurs");
  assertStringIncludes(html, '"name":"Les Joueurs"');
});

Deno.test("association page shows the city only", () => {
  const html = renderAssociationPage(associationFixture(), BASE);
  assertStringIncludes(html, "Lyon");
  assert(!html.includes("12 rue"));
  assertStringIncludes(html, '"@type":"Organization"');
  assertStringIncludes(html, '"addressLocality":"Lyon"');
  assert(!html.includes("streetAddress"));
  assertStringIncludes(html, "mlat=45.764&amp;mlon=4.836#map=17/45.764/4.836");
  assertStringIncludes(html, "Disponible dans l&#39;application");
  assertStringIncludes(html, "Partie du mardi");
});

Deno.test("not found and unavailable pages", () => {
  for (const s of [404, 410] as const) {
    const h = renderNotFound(s);
    assertStringIncludes(h, '<meta name="robots" content="noindex">');
    assertStringIncludes(h, "Cette page n&#39;existe pas ou n&#39;est plus disponible.");
  }
  const u = renderUnavailable();
  assertStringIncludes(u, "noindex");
  assert(!u.includes("Error"));
});

Deno.test("jsonLd escapes U+2028 and U+2029 to backslash-u text", () => {
  const ls = String.fromCharCode(0x2028), ps = String.fromCharCode(0x2029), bs = String.fromCharCode(92);
  const out = jsonLd({ a: `x${ls}y${ps}z` });
  assert(!out.includes(ls) && !out.includes(ps));
  assertStringIncludes(out, `${bs}${bs}u2028`.slice(1));
  assertStringIncludes(out, `${bs}u2029`);
  assertEquals(JSON.parse(out).a, `x${ls}y${ps}z`);
});

Deno.test("open-in-app is an Android intent link with the Play Store fallback", () => {
  const store = "https://play.google.com/store/apps/details?id=fr.x";
  const html = renderActivityPage(activityFixture(), BASE, { playStore: store, androidPackage: "fr.test.app" });
  const href = html.match(/href="(intent:[^"]+)"/)![1].replaceAll("&amp;", "&");
  assertStringIncludes(href, "intent://activites/11111111-1111-4111-8111-111111111111#Intent;scheme=friendapp;package=fr.test.app;");
  assertStringIncludes(href, "S.browser_fallback_url=" + encodeURIComponent(store));
  assert(href.endsWith(";end"));
  const def = renderActivityPage(activityFixture(), BASE);
  assertStringIncludes(def, "package=fr.friendapp.app;");
});

Deno.test("label and map pin both come from the activity, whatever the session says", () => {
  const html = renderActivityPage(activityFixture({
    next_sessions: [{ starts_at: "2026-10-27T18:00:00Z", status: "scheduled", confirmed_count: 1, place_label: "Autre lieu" }],
  }), BASE);
  assertStringIncludes(html, "mlat=45.764&amp;mlon=4.8357");
  assertStringIncludes(html, "Café des Arts, Lyon");
  assert(!html.includes("Autre lieu"));
});

Deno.test("association primary button is Ouvrir dans l'application, download stays visible", () => {
  const html = renderAssociationPage(associationFixture(), BASE);
  assertStringIncludes(html, 'class="button primary" href="intent://associations/');
  assertStringIncludes(html, "Ouvrir dans l&#39;application");
  assertStringIncludes(html, "Télécharger l&#39;application");
  assert(!html.includes("Rejoindre l&#39;activité"));
});

Deno.test("recurrence wording for weekdays", () => {
  const one = renderActivityPage(activityFixture({ recurrence_kind: "weekdays", recurrence_weekdays: [1] }), BASE);
  assertStringIncludes(one, "Le lundi");
  const many = renderActivityPage(activityFixture({ recurrence_kind: "weekdays", recurrence_weekdays: [1, 2, 4] }), BASE);
  assertStringIncludes(many, "Les lundis, mardis et jeudis");
  const two = renderActivityPage(activityFixture({ recurrence_kind: "weekdays", recurrence_weekdays: [1, 2] }), BASE);
  assertStringIncludes(two, "Les lundis et mardis");
});

Deno.test("confirmed count: 1 is singular, 0 is not shown", () => {
  const one = renderActivityPage(activityFixture({ next_sessions: [{ starts_at: "2026-11-02T18:00:00Z", confirmed_count: 1 }] }), "https://h.test");
  assertStringIncludes(one, "<li>1 confirmé</li>");
  assertEquals(one.includes("1 confirmés"), false);
  const zero = renderActivityPage(activityFixture({ next_sessions: [{ starts_at: "2026-11-02T18:00:00Z", confirmed_count: 0 }] }), "https://h.test");
  assertEquals(zero.includes("confirmé"), false);
  assertStringIncludes(zero, "Prochaine séance");
  const missing = renderActivityPage(activityFixture({ next_sessions: [{ starts_at: "2026-11-02T18:00:00Z" }] }), "https://h.test");
  assertEquals(missing.includes("confirmé"), false);
});
