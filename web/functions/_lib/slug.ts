const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function slugify(text: string, max = 60): string {
  const s = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, max).replace(/-+$/g, "");
}

/** The id is the trailing UUID of the segment. */
export function parseSlugId(path: string): { id: string | null; slug: string } {
  const m = UUID_RE.exec(path);
  if (!m) return { id: null, slug: path };
  const before = path.slice(0, m.index);
  if (before !== "" && !before.endsWith("-")) return { id: null, slug: path };
  return { id: m[1].toLowerCase(), slug: before.replace(/-$/, "") };
}

export const activityPath = (id: string, title: string) => {
  const s = slugify(title);
  return `/activites/${s ? s + "-" : ""}${id}`;
};
export const associationPath = (id: string, name: string, city: string | null | undefined) => {
  const s = slugify(`${name} ${city ?? ""}`);
  return `/associations/${s ? s + "-" : ""}${id}`;
};
