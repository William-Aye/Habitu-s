// Legal pages (/mentions-legales, /conditions, /confidentialite). Kept apart from html.ts/pages.ts.
// The privacy text is the app's own French text (plain data), so the app and the site never drift.
import { privacyFr } from "../../../app/src/content/privacy.fr.ts";
import { PRIVACY_CONTACT } from "../../../app/src/content/contact.ts";
import { copy } from "./copy.ts";
import { escapeHtml } from "./html.ts";
import { SECURITY_HEADERS } from "./pages.ts";

export type LegalKind = "mentions" | "terms" | "privacy";

const text = {
  publisher: "Éditeur : [NOM À COMPLÉTER]",
  contact: (c: string) => `Contact : ${c}`,
  host: "Hébergeur : Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis.",
  data: "Données : Supabase (région UE).",
  terms: "[À COMPLÉTER AVANT LANCEMENT] Les conditions générales d'utilisation seront publiées ici avant l'ouverture du service.",
} as const;

/** Blank-line separated blocks; "# " starts a heading; consecutive "- " lines make a list. */
function privacyBody(source: string): string {
  const out: string[] = [];
  let firstHeading = true;
  for (const block of source.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    if (block.startsWith("# ")) {
      const tag = firstHeading ? "h1" : "h2";
      firstHeading = false;
      out.push(`<${tag}>${escapeHtml(block.slice(2).trim())}</${tag}>`);
      continue;
    }
    let list: string[] = [];
    const flush = () => {
      if (list.length) out.push(`<ul>${list.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`);
      list = [];
    };
    for (const line of block.split("\n")) {
      if (line.startsWith("- ")) list.push(line.slice(2).trim());
      else {
        flush();
        out.push(`<p>${escapeHtml(line.trim())}</p>`);
      }
    }
    flush();
  }
  return out.join("\n");
}

function mainFor(kind: LegalKind): string {
  if (kind === "mentions") {
    return `<h1>${escapeHtml(copy.legal.mentions)}</h1>
<p>${escapeHtml(text.publisher)}</p>
<p>${escapeHtml(text.contact(PRIVACY_CONTACT))}</p>
<p>${escapeHtml(text.host)}</p>
<p>${escapeHtml(text.data)}</p>`;
  }
  if (kind === "terms") {
    return `<h1>${escapeHtml(copy.legal.terms)}</h1>\n<p>${escapeHtml(text.terms)}</p>`;
  }
  return privacyBody(privacyFr);
}

export function renderLegalPage(kind: LegalKind): string {
  const title = copy.legal[kind];
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${title} · ${copy.siteName}`)}</title>
<meta name="description" content="${escapeHtml(copy.tagline)}">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="site-header"><a href="/">${escapeHtml(copy.siteName)}</a></header>
<main class="legal">
${mainFor(kind)}
</main>
<footer class="site-footer">
<a href="/mentions-legales">${escapeHtml(copy.legal.mentions)}</a>
<a href="/conditions">${escapeHtml(copy.legal.terms)}</a>
<a href="/confidentialite">${escapeHtml(copy.legal.privacy)}</a>
</footer>
</body>
</html>
`;
}

export function legalResponse(kind: LegalKind): Response {
  return new Response(renderLegalPage(kind), {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, max-age=60",
    },
  });
}

/** Parses a Cloudflare `_headers` file: a path line, then indented "Name: value" lines. */
export function parseHeadersFile(src: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let cur: Record<string, string> | null = null;
  for (const raw of src.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      const i = raw.indexOf(":");
      if (cur && i > 0) cur[raw.slice(0, i).trim()] = raw.slice(i + 1).trim();
    } else {
      cur = {};
      out.set(raw.trim(), cur);
    }
  }
  return out;
}
