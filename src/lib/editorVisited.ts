// Countries the site's editor has personally traveled (owner's own statement,
// 2026-08-08; France added 2026-08-09 — Paris confirmed): Vietnam
// (extensively), Singapore, Thailand, South Korea (almost every region), the
// US (incl. Hawaii), Australia, Laos, Cambodia, Indonesia, Hong Kong, Macau,
// China, France. The owner has visited MORE (parts of Europe, more cities)
// but does not recall the full list — only countries explicitly named get a
// badge; never infer one. This is the factual basis behind the
// "Editor-reviewed" line and the monthly picks' editor framing — a real
// person, not an invented persona. The badge speaks at COUNTRY level on
// purpose: having traveled a country does not claim every city in it.
// 2026-08-09 second recollection: Russia, New Zealand, Czech Republic, Spain,
// Japan. 2026-08-13 third recollection: Mongolia, Georgia. 2026-08-15 fourth
// recollection: Taiwan (owner: "나는 대만도 가봤어"). Spellings must
// match the corpus's `country:` values exactly — Czechia vs Czech Republic
// etc. only matters once such posts exist; keep both-safe entries for
// countries without content yet. Guam was indirect-only (owner's statement,
// 2026-08-13) — never badge it.
const VISITED_COUNTRIES = new Set([
  'Vietnam', 'Singapore', 'Thailand', 'South Korea', 'United States',
  'Australia', 'Laos', 'Cambodia', 'Indonesia', 'China', 'France',
  'Japan', 'Spain', 'Russia', 'New Zealand', 'Czech Republic', 'Czechia',
  'Hong Kong', 'Mongolia', 'Georgia', 'Taiwan',
]);
// Hong Kong became its own country entry on 2026-08-13 (split from China);
// the region entries stay for legacy posts tagged region: Hong Kong/Macau.
const VISITED_REGIONS = new Set(['Hong Kong', 'Macau']);

export function editorHasTraveled(country?: string, region?: string): boolean {
  return (!!country && VISITED_COUNTRIES.has(country)) || (!!region && VISITED_REGIONS.has(region));
}
