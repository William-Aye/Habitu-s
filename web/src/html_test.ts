import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { escapeHtml, formatParisDate, jsonLd, renderActivityPage, renderAssociationPage, renderHome, renderNotFound, renderUnavailable } from "./html.ts";
import { activityFixture, associationFixture, EVIL } from "./fixtures.ts";

const BASE = "https://habituer.test";

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
  assertStringIncludes(html, "<title>Jeu de go · Habituer</title>");
  assertStringIncludes(html, `<link rel="canonical" href="${BASE}/activites/jeu-de-go-11111111-1111-4111-8111-111111111111">`);
  for (const k of ["og:title", "og:description", "og:url", "og:image", "og:type", "og:locale"]) {
    assertStringIncludes(html, `property="${k}"`);
  }
  assertStringIncludes(html, `content="${BASE}/og-default.png"`);
  assertStringIncludes(html, 'content="fr_FR"');
  assertStringIncludes(html, 'name="twitter:card" content="summary"');
  assertStringIncludes(html, "Prochaine séance : mardi 27 octobre à 19:00");
  assertStringIncludes(html, "3 confirmés");
  assertStringIncludes(html, "Organisé par un membre");
  assert(!html.includes("Camille"));
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

Deno.test("the organising association or collectif is named, a member never is", () => {
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
  assertStringIncludes(href, "intent://activites/11111111-1111-4111-8111-111111111111#Intent;scheme=habituer;package=fr.test.app;");
  assertStringIncludes(href, "S.browser_fallback_url=" + encodeURIComponent(store));
  assert(href.endsWith(";end"));
  const def = renderActivityPage(activityFixture(), BASE);
  assertStringIncludes(def, "package=fr.habituer.app;");
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

Deno.test("the organiser's first name and photo are nowhere in the body or the JSON-LD", () => {
  const first = "Zéphyrine-Qxv";
  for (const organised_by of [null, { kind: "association", id: "a", name: "Les Joueurs" }, { kind: "collectif", id: "c", name: "Les Amis" }]) {
    const html = renderActivityPage(
      activityFixture({ organiser: { id: "u9", first_name: first, photo_url: "https://x/zephyr-qxv.jpg" }, organised_by }),
      BASE,
    );
    assertEquals(html.includes(first), false);
    assertEquals(html.includes("Zéphyrine"), false);
    assertEquals(html.includes("zephyr-qxv"), false);
    assertEquals(html.includes("u9"), false);
  }
});

Deno.test("JSON-LD Event: complete for Google with a next session, absent without one", () => {
  const ldOf = (html: string) => html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const ev = JSON.parse(ldOf(renderActivityPage(activityFixture(), BASE))![1]);
  assertEquals(ev.startDate, "2026-10-27T18:00:00.000Z");
  assertEquals(ev.endDate, "2026-10-27T20:00:00.000Z");
  assertEquals(ev.eventStatus, "https://schema.org/EventScheduled");
  assertEquals(ev.location, {
    "@type": "Place",
    name: "Café des Arts, Lyon",
    address: "Café des Arts, Lyon",
    geo: { "@type": "GeoCoordinates", latitude: 45.764, longitude: 4.8357 },
  });
  // A session's own place label never reaches the page, structured data included.
  const moved = renderActivityPage(activityFixture({
    next_sessions: [{ id: "s1", starts_at: "2026-10-27T18:00:00Z", place_label: "Autre lieu", status: "scheduled" }],
  }), BASE);
  assertEquals(JSON.parse(ldOf(moved)![1]).location.name, "Café des Arts, Lyon");
  // No upcoming session: an Event without startDate is invalid for Google, so none is emitted.
  const none = renderActivityPage(activityFixture({ next_sessions: [] }), BASE);
  assertEquals(ldOf(none), null);
  assertStringIncludes(none, "<h1>Jeu de go</h1>");
});

Deno.test("JSON-LD organizer: the organisation when there is one, omitted otherwise", () => {
  const ld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
  const none = ld(renderActivityPage(activityFixture({ organised_by: null }), BASE));
  assertEquals("organizer" in none, false);
  assertStringIncludes(renderActivityPage(activityFixture({ organised_by: null }), BASE), "Organisé par un membre");
  const asso = ld(renderActivityPage(activityFixture({ organised_by: { kind: "association", id: "a", name: "Les Joueurs" } }), BASE));
  assertEquals(asso.organizer, { "@type": "Organization", name: "Les Joueurs" });
});

Deno.test("home page: a welcoming title, three steps, reassurance, and both ways in", () => {
  const html = renderHome("https://x.test", "https://play.test/app");
  assertStringIncludes(html, "<h1>Retrouvez les mêmes visages, chaque semaine</h1>");
  assertEquals((html.match(/<ol class="steps">([\s\S]*?)<\/ol>/)![1].match(/<li>/g) ?? []).length, 3);
  assertStringIncludes(html, "Venez comme vous êtes");
  assertStringIncludes(html, 'class="button primary" href="https://play.test/app"');
  assertStringIncludes(html, 'href="/app/"');
  assertStringIncludes(html, '<meta name="description" content="Des activités régulières près de chez vous">');
});

Deno.test("every page shows the logo mark and links the SVG favicon, which is served as a static file", async () => {
  for (const h of [renderHome("https://habituer.org"), renderNotFound(404)]) {
    assertStringIncludes(h, '<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    assertStringIncludes(h, '<svg class="logo"');
    assertStringIncludes(h, 'aria-hidden="true"');
  }
  const svg = await Deno.readTextFile("web/public/favicon.svg");
  assertStringIncludes(svg, "#b4441f");
  assert(!svg.includes("<script"));
  const routes = JSON.parse(await Deno.readTextFile("web/public/_routes.json"));
  assert(routes.exclude.includes("/favicon.svg"));
  for (const h of [renderHome("https://habituer.org"), renderNotFound(404)]) {
    assertStringIncludes(h, '<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  }
  assert(routes.exclude.includes("/apple-touch-icon.png"));
  const png = await Deno.readFile("web/public/apple-touch-icon.png");
  assertEquals([png[1], png[2], png[3]], [0x50, 0x4e, 0x47]); // "PNG"
  assertEquals((png[16] << 24 | png[17] << 16 | png[18] << 8 | png[19]), 180); // width
});
