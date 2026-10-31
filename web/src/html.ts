import { copy } from "./copy.ts";
import { activityPath, associationPath } from "./slug.ts";

export const DEFAULT_PLAY_STORE = "https://play.google.com/store/apps";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const bs = String.fromCharCode(92);
const LINE_SEPARATORS = new RegExp("[" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "]", "g");

/** JSON for a <script type="application/ld+json">: no raw "<" can close the element. */
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATORS, (c) => bs + "u" + c.charCodeAt(0).toString(16));
}

const parisFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "mardi 27 octobre à 19:00" in Europe/Paris. */
export function formatParisDate(iso: string): string {
  const p: Record<string, string> = {};
  for (const part of parisFmt.formatToParts(new Date(iso))) p[part.type] = part.value;
  return `${p.weekday} ${p.day} ${p.month} à ${p.hour}:${p.minute}`;
}

const first = (s: string, n: number) => Array.from(s).slice(0, n).join("");

// deno-lint-ignore no-explicit-any
type Json = any;

interface Meta {
  title: string;
  description: string;
  canonical: string;
  base: string;
  ld?: unknown;
  noindex?: boolean;
  main: string;
}

function footer(): string {
  return `<footer class="site-footer">
<a href="/mentions-legales">${escapeHtml(copy.legal.mentions)}</a>
<a href="/conditions">${escapeHtml(copy.legal.terms)}</a>
<a href="/confidentialite">${escapeHtml(copy.legal.privacy)}</a>
</footer>`;
}

function layout(m: Meta): string {
  const t = escapeHtml(`${m.title} · ${copy.siteName}`);
  const d = escapeHtml(first(m.description, 155));
  const og = m.canonical
    ? `<link rel="canonical" href="${escapeHtml(m.canonical)}">
<meta property="og:title" content="${escapeHtml(m.title)}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${escapeHtml(m.canonical)}">
<meta property="og:image" content="${escapeHtml(m.base)}/og-default.png">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(m.title)}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${escapeHtml(m.base)}/og-default.png">
`
    : "";
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${d}">
${m.noindex ? '<meta name="robots" content="noindex">\n' : ""}${og}<link rel="stylesheet" href="/styles.css">
${m.ld ? `<script type="application/ld+json">${jsonLd(m.ld)}</script>\n` : ""}</head>
<body>
<header class="site-header"><a href="/">${escapeHtml(copy.siteName)}</a></header>
<main>
${m.main}
</main>
${footer()}
</body>
</html>
`;
}

function osmUrl(lat: unknown, lon: unknown, decimals?: number): string | null {
  if (lat == null || lon == null) return null;
  let la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (decimals !== undefined) {
    la = Number(la.toFixed(decimals));
    lo = Number(lo.toFixed(decimals));
  }
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=17/${la}/${lo}`;
}

export interface RenderOpts {
  playStore?: string;
  androidPackage?: string;
}
export const DEFAULT_ANDROID_PACKAGE = "fr.habitues.app";

function intentUrl(route: string, playStore: string, pkg: string): string {
  return `intent://${route}#Intent;scheme=habitues;package=${pkg};S.browser_fallback_url=${encodeURIComponent(playStore)};end`;
}

function actions(o: { webPath?: string; intent: string; playStore: string; map: string | null }): string {
  const map = o.map;
  const playStore = o.playStore;
  return `<p class="actions">
${o.webPath ? `<a class="button primary" href="${escapeHtml(o.webPath)}">${escapeHtml(copy.imThere)}</a>
<a class="button" href="${escapeHtml(o.intent)}">${escapeHtml(copy.openInApp)}</a>` : `<a class="button primary" href="${escapeHtml(o.intent)}">${escapeHtml(copy.openInApp)}</a>`}
<a class="button" href="${escapeHtml(playStore)}">${escapeHtml(copy.downloadApp)}</a>
${map ? `<a class="button" href="${escapeHtml(map)}" rel="noopener nofollow">${escapeHtml(copy.seeOnMap)}</a>` : ""}
</p>`;
}

function recurrenceText(a: Json): string {
  if (a.recurrence_kind === "weekly") return copy.recurrence.weekly;
  if (a.recurrence_kind === "every_n_days" && a.recurrence_interval_days) {
    return copy.recurrence.everyNDays(a.recurrence_interval_days);
  }
  if (a.recurrence_kind === "weekdays" && Array.isArray(a.recurrence_weekdays)) {
    const days = [...new Set(a.recurrence_weekdays as number[])].sort((x, y) => x - y).filter((d) => d >= 1 && d <= 7);
    if (days.length === 0) return "";
    if (days.length === 1) return copy.recurrence.oneDay(copy.weekdayNames[days[0] - 1]);
    const names = days.map((d) => copy.weekdayPlurals[d - 1]);
    return copy.recurrence.manyDays(`${names.slice(0, -1).join(", ")} ${copy.and} ${names[names.length - 1]}`);
  }
  return "";
}

export function renderActivityPage(a: Json, base: string, opts: RenderOpts = {}): string {
  const playStore = opts.playStore ?? DEFAULT_PLAY_STORE;
  const pkg = opts.androidPackage ?? DEFAULT_ANDROID_PACKAGE;
  const url = base + activityPath(a.id, a.title ?? "");
  const sessions: Json[] = Array.isArray(a.next_sessions) ? a.next_sessions : [];
  const next = sessions.find((s) => s.status !== "cancelled") ?? null;
  const confirmed = next ? copy.confirmed(Number(next.confirmed_count ?? 0)) : "";
  // Public pages never name a member: only the organising association or collectif.
  const org: string | null = a.organised_by?.name ?? null;
  const desc: string = a.description ?? "";
  const rec = recurrenceText(a);
  const place = a.place_label;
  const mapUrl = osmUrl(a.lat, a.lon);

  const ld: Json = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: a.title,
    description: desc,
    url,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: place },
  };
  if (next) ld.startDate = new Date(next.starts_at).toISOString();
  if (a.start_date && a.start_time) {
    const sched: Json = {
      "@type": "Schedule",
      startDate: a.start_date,
      startTime: String(a.start_time).slice(0, 5),
      scheduleTimezone: a.timezone ?? "Europe/Paris",
    };
    if (a.duration_minutes) sched.duration = `PT${a.duration_minutes}M`;
    if (a.recurrence_kind === "weekly") sched.repeatFrequency = "P1W";
    else if (a.recurrence_kind === "every_n_days" && a.recurrence_interval_days) {
      sched.repeatFrequency = `P${a.recurrence_interval_days}D`;
    } else if (a.recurrence_kind === "weekdays" && Array.isArray(a.recurrence_weekdays)) {
      const en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      sched.repeatFrequency = "P1W";
      sched.byDay = (a.recurrence_weekdays as number[]).map((d) => `https://schema.org/${en[d - 1]}`);
    }
    ld.eventSchedule = sched;
  }
  if (org) ld.organizer = { "@type": "Organization", name: org };

  const main = `<article class="activity">
<h1>${escapeHtml(a.title)}</h1>
${a.category?.name_fr ? `<p class="category">${escapeHtml(a.category.name_fr)}</p>` : ""}
${desc ? `<p class="description">${escapeHtml(desc)}</p>` : ""}
<ul class="facts">
${place ? `<li>${escapeHtml(place)}</li>` : ""}
${rec ? `<li>${escapeHtml(rec)}</li>` : ""}
${next ? `<li>${escapeHtml(copy.nextSession(formatParisDate(next.starts_at)))}</li>` : ""}
${next && confirmed ? `<li>${escapeHtml(confirmed)}</li>` : ""}
<li>${escapeHtml(org ? copy.organisedBy(org) : copy.organisedByMember)}</li>
</ul>
${actions({ webPath: `/app/activites/${a.id}`, intent: intentUrl(`activites/${a.id}`, playStore, pkg), playStore, map: mapUrl })}
</article>`;
  return layout({ title: a.title ?? copy.siteName, description: desc || copy.tagline, canonical: url, base, ld, main });
}

export function renderAssociationPage(x: Json, base: string, opts: RenderOpts = {}): string {
  const playStore = opts.playStore ?? DEFAULT_PLAY_STORE;
  const pkg = opts.androidPackage ?? DEFAULT_ANDROID_PACKAGE;
  const url = base + associationPath(x.id, x.name ?? "", x.city);
  const desc: string = x.purpose ?? "";
  const ld: Json = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: x.name,
    description: desc || undefined,
    url,
    address: { "@type": "PostalAddress", addressLocality: x.city ?? undefined, addressCountry: "FR" },
  };
  const safeWebsite = typeof x.website === "string" && /^https?:\/\//i.test(x.website) ? x.website : null;
  if (safeWebsite) ld.sameAs = [safeWebsite];
  const acts: Json[] = Array.isArray(x.activities) ? x.activities : [];

  const main = `<article class="association">
<h1>${escapeHtml(x.name)}</h1>
${x.city ? `<p class="city">${escapeHtml(x.city)}</p>` : ""}
${desc ? `<p class="description">${escapeHtml(desc)}</p>` : ""}
<ul class="facts">
${safeWebsite ? `<li><a href="${escapeHtml(safeWebsite)}" rel="noopener nofollow ugc">${escapeHtml(copy.website)}</a></li>` : ""}
${x.source_label ? `<li>${escapeHtml(x.source_label)}</li>` : ""}
</ul>
${acts.length ? `<h2>${escapeHtml(copy.activitiesHeading)}</h2>
<ul class="activities">
${acts.map((t) => `<li><a href="${escapeHtml(activityPath(t.id, t.title ?? ""))}">${escapeHtml(t.title)}</a></li>`).join("\n")}
</ul>` : ""}
<p class="in-app">${escapeHtml(copy.availableInApp)}</p>
${actions({ intent: intentUrl(`associations/${x.id}`, playStore, pkg), playStore, map: osmUrl(x.lat, x.lon, 3) })}
</article>`;
  return layout({ title: x.name ?? copy.siteName, description: desc || copy.tagline, canonical: url, base, ld, main });
}

export function renderNotFound(_status: 404 | 410): string {
  return layout({
    title: copy.siteName,
    description: copy.notFound,
    canonical: "",
    base: "",
    noindex: true,
    main: `<p>${escapeHtml(copy.notFound)}</p>\n<p><a href="/">${escapeHtml(copy.siteName)}</a></p>`,
  });
}

export function renderUnavailable(): string {
  return layout({
    title: copy.unavailableTitle,
    description: copy.unavailable,
    canonical: "",
    base: "",
    noindex: true,
    main: `<p>${escapeHtml(copy.unavailable)}</p>`,
  });
}

export function renderHome(base: string, playStore: string = DEFAULT_PLAY_STORE): string {
  return layout({
    title: copy.siteName,
    description: copy.tagline,
    canonical: base + "/",
    base,
    main: `<h1>${escapeHtml(copy.siteName)}</h1>
<p class="tagline">${escapeHtml(copy.tagline)}</p>
<p class="actions"><a class="button primary" href="${escapeHtml(playStore)}">${escapeHtml(copy.downloadApp)}</a></p>`,
  });
}
