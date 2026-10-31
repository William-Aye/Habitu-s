// Legal pages (/mentions-legales, /conditions, /confidentialite). Kept apart from html.ts/pages.ts.
// The privacy text is the app's own French text (plain data), so the app and the site never drift.
import { privacyFr } from "../../app/src/content/privacy.fr.ts";
import { PRIVACY_CONTACT } from "../../app/src/content/contact.ts";
import { copy } from "./copy.ts";
import { escapeHtml } from "./html.ts";
import { SECURITY_HEADERS } from "./pages.ts";

export type LegalKind = "mentions" | "terms" | "privacy";

const text = {
  publisher: "Éditeur : [NOM À COMPLÉTER]",
  contact: (c: string) => `Contact : ${c}`,
  host: "Hébergeur : Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis.",
  hostPhone: "Téléphone de l'hébergeur : [À COMPLÉTER]",
  data: "Données : Supabase (région UE).",
  dataHost: "Supabase : société [À COMPLÉTER], adresse [À COMPLÉTER], téléphone [À COMPLÉTER].",
} as const;

/** The terms of use (CGU), in the same plain format as the privacy text: "# " headings, "- " lists. */
const termsFr = `# Conditions d'utilisation

Dernière mise à jour : 30 octobre 2026

Ces conditions expliquent, simplement, ce que vous pouvez attendre de Habitués et ce que nous attendons de vous. En créant un compte ou en utilisant l'application ou le site, vous les acceptez.

# Objet

Habitués est un service gratuit qui aide des adultes à trouver des associations et des activités régulières près de chez eux, à les rejoindre et à rencontrer des gens autour de ces activités. Le service est édité par la personne ou la structure indiquée dans les mentions légales.

Habitués met en relation. Nous n'organisons pas les activités publiées par les membres et nous ne sommes pas partie aux rencontres qui en découlent.

# Accès au service

- Le service est réservé aux personnes de 18 ans ou plus. En créant un compte, vous confirmez avoir 18 ans ou plus. Nous ne demandons pas votre date de naissance. Nous supprimons un compte dont nous apprenons qu'il appartient à une personne mineure.
- Vous pouvez parcourir les activités et les associations sans compte. Un compte est nécessaire pour rejoindre une activité, en organiser une, discuter dans un groupe ou signaler un contenu.
- Pour vous connecter, vous utilisez votre compte Google ou un code à 8 chiffres reçu par e-mail. Il n'y a pas de mot de passe. Vous restez responsable de l'accès à votre e-mail, à votre compte Google et à votre téléphone.
- Une personne, un compte. Donnez votre prénom (jamais votre nom de famille) et des informations exactes.
- Nous faisons de notre mieux pour que le service fonctionne, mais il peut être interrompu, pour une maintenance ou en cas de panne, sans que nous puissions le garantir en continu.

# Règles de conduite

Pour que les rencontres se passent bien, vous vous engagez à :

- respecter les autres : pas de harcèlement, d'insultes, de menaces, de propos discriminatoires, haineux ou sexuellement explicites, et pas de comportement inapproprié pendant ou après une activité ;
- ne publier que des activités réelles, dans un lieu public, et ne pas publier de faux contenus, de publicité ni de messages répétés non sollicités (spam) ;
- ne pas vous faire passer pour quelqu'un d'autre, ni pour une association ou un collectif que vous ne représentez pas ;
- ne pas collecter d'informations sur les autres membres, ni utiliser le service pour démarcher ou vendre quoi que ce soit ;
- ne rien faire d'illégal et ne pas chercher à perturber ou à contourner la sécurité du service.

Ces règles sont celles que vous retrouvez dans les motifs de signalement : lieu dangereux ou inadapté, comportement inapproprié, harcèlement, faux ou spam, activité qui n'a pas eu lieu.

Rappel de sécurité pour les rencontres. Habitués ne vérifie pas l'identité des membres. Pour une première rencontre, restez dans le lieu public prévu, organisez votre propre trajet, prévenez un proche de l'endroit où vous allez, et partez si quelque chose vous met mal à l'aise. Si vous êtes en danger, appelez le 17 ou le 112. Vous restez seul responsable de votre décision de rencontrer quelqu'un.

# Contenus des utilisateurs

Vous restez propriétaire de ce que vous publiez (présentation, photo, activités, messages). Vous donnez à Habitués le droit, gratuit et limité au fonctionnement du service, de les stocker et de les afficher aux personnes concernées, tant que le contenu existe.

Vous garantissez avoir le droit de publier ce que vous publiez. Ne publiez pas de photo d'une autre personne sans son accord, ni d'information sur la vie privée de quelqu'un d'autre. Nous pouvons retirer un contenu qui ne respecte pas ces conditions ou la loi.

# Signalement et modération

Vous pouvez signaler une activité, une séance, un collectif, un message ou une personne depuis l'application, et bloquer une personne. Le signalement est examiné par l'équipe de modération, qui peut retirer un contenu, avertir ou suspendre un compte.

Quand nous retirons un contenu ou suspendons un compte, la personne concernée reçoit un exposé des motifs : ce qui a été décidé et pourquoi. La personne qui a fait le signalement est informée de la suite donnée. Vous retrouvez ces informations dans l'application, dans Profil, « Informations de modération ».

Pour contester une décision, écrivez à ${PRIVACY_CONTACT} en rappelant votre prénom et la décision visée. Nous réexaminons la décision et vous répondons en indiquant nos motifs. Une décision contestée peut être confirmée, modifiée ou annulée. Cela ne vous prive pas de vos recours devant un tribunal.

# Suspension et suppression du compte

- Vous pouvez supprimer votre compte à tout moment, dans Profil, « Mes données ». La suppression est immédiate et définitive, après confirmation. Elle supprime aussi les activités que vous organisez, avec leurs séances, leurs présences et les messages de leur groupe.
- Nous pouvons suspendre ou supprimer un compte qui ne respecte pas ces conditions, après avoir examiné la situation. En cas de risque grave pour d'autres personnes, la suspension peut être immédiate. Vous êtes informé du motif.
- Un compte inactif depuis 3 ans est supprimé. Une notification (et un message dans l'application) vous prévient 30 jours avant, si vous avez activé les notifications ; ouvrir l'application garde le compte. Un compte suspendu ne reçoit pas cet avertissement et est supprimé après 36 mois et 30 jours sans activité.
- Certaines données liées à un signalement ou à une décision de modération sont conservées comme preuve pendant la durée indiquée dans la politique de confidentialité, même après la suppression d'un compte.

# Responsabilité

Habitués fournit un service de mise en relation. Nous ne contrôlons pas à l'avance les activités, les lieux ni les personnes, et nous ne garantissons pas que les informations publiées par les membres ou par les associations soient exactes, complètes ou à jour. Les données sur les associations viennent de sources publiques.

Chaque personne est responsable de ce qu'elle publie et de son comportement. Nous ne sommes pas responsables des dommages causés par une rencontre, une activité ou un contenu publié par un tiers, sauf dans les cas où la loi l'impose. Cela ne limite pas vos droits de consommateur, ni notre responsabilité en cas de faute de notre part.

Vous pouvez nous signaler à tout moment un contenu que vous estimez illicite, avec le bouton Signaler, ou en écrivant à ${PRIVACY_CONTACT}.

# Données personnelles

Nous collectons peu de données : un prénom, un e-mail ou un compte Google, une zone d'habitation au niveau de la commune et ce que vous choisissez d'ajouter. Elles ne sont jamais vendues ni données à des annonceurs. La politique de confidentialité explique quelles données nous traitons, pourquoi, combien de temps nous les gardons, qui les traite pour nous et comment exercer vos droits (accès, correction, suppression, opposition). Elle fait partie de ces conditions.

Pour toute question sur vos données : ${PRIVACY_CONTACT}. Vous pouvez aussi saisir la CNIL (www.cnil.fr).

# Modification des conditions

Nous pouvons modifier ces conditions, par exemple quand une fonction est ajoutée. La nouvelle version est publiée sur cette page avec sa date de mise à jour. Si vous continuez à utiliser le service après cette date, vous acceptez la nouvelle version ; sinon, vous pouvez supprimer votre compte. La date de dernière mise à jour est en haut de cette page.

# Droit applicable

Ces conditions sont régies par le droit français. En cas de litige, nous cherchons d'abord une solution amiable : écrivez à ${PRIVACY_CONTACT}. Si vous êtes consommateur, vous pouvez recourir gratuitement à un médiateur de la consommation, et vous gardez le droit de saisir les tribunaux compétents selon les règles applicables en France.
`;

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
<p>${escapeHtml(text.hostPhone)}</p>
<p>${escapeHtml(text.data)}</p>
<p>${escapeHtml(text.dataHost)}</p>`;
  }
  if (kind === "terms") {
    return privacyBody(termsFr);
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
