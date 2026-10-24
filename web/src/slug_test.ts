import { assertEquals } from "jsr:@std/assert@1";
import { parseSlugId, slugify } from "./slug.ts";
import fixtures from "./slug_fixtures.json" with { type: "json" };

Deno.test("slugify fixtures", () => {
  for (const c of fixtures.slugify) assertEquals(slugify(c.input), c.slug, c.input);
});

Deno.test("slugify caps at 60 characters without a trailing dash", () => {
  const s = slugify(fixtures.slugifyMax60.input);
  assertEquals(s, fixtures.slugifyMax60.slug);
  assertEquals(s.length <= 60, true);
  assertEquals(s.endsWith("-"), false);
});

Deno.test("parseSlugId fixtures", () => {
  for (const c of fixtures.parseSlugId) {
    assertEquals(parseSlugId(c.input), { id: c.id, slug: c.slug }, c.input);
  }
});
