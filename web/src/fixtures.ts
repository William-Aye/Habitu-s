// Shared test helpers (no Cloudflare types).
export const EVIL = `</script><script>alert(1)</script>"'&`;
export const ACT_ID = "11111111-1111-4111-8111-111111111111";
export const ASSO_ID = "22222222-2222-4222-8222-222222222222";

// deno-lint-ignore no-explicit-any
export function activityFixture(over: Record<string, any> = {}): any {
  return {
    id: ACT_ID,
    title: "Jeu de go",
    description: "Venez jouer au go entre amis.",
    category: { id: 1, slug: "jeux", name_fr: "Jeux", name_en: "Games", icon: "dice" },
    tags: [],
    organiser: { id: "u1", first_name: "Camille", photo_url: "https://x/photo.jpg" },
    organised_by: null,
    place_label: "Café des Arts, Lyon",
    lon: 4.8357,
    lat: 45.764,
    recurrence_kind: "weekly",
    recurrence_interval_days: null,
    recurrence_weekdays: null,
    start_date: "2026-10-27",
    start_time: "19:00:00",
    duration_minutes: 120,
    timezone: "Europe/Paris",
    max_size: 8,
    next_sessions: [{
      id: "s1",
      starts_at: "2026-10-27T18:00:00Z",
      place_label: "Café des Arts, Lyon",
      status: "scheduled",
      confirmed_count: 3,
      attendees: [
        { id: "p1", first_name: "Alice", photo_url: null },
        { id: "p2", first_name: "Bob", photo_url: null },
      ],
    }],
    ...over,
  };
}

// deno-lint-ignore no-explicit-any
export function associationFixture(over: Record<string, any> = {}): any {
  return {
    id: ASSO_ID,
    name: "Club de go",
    purpose: "Promouvoir le jeu de go.",
    city: "Lyon",
    postcode: "69001",
    street: "12 rue Secrète",
    lon: 4.83567,
    lat: 45.76412,
    website: "https://go.example",
    source_label: "Source : RNA",
    activities: [{ id: ACT_ID, title: "Partie du mardi" }],
    ...over,
  };
}
