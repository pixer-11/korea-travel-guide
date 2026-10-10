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
// The one list (display order) — the badge set below and the editorial-policy
// page (2026-10-01) both read it, so a new country is one line here.
// `place` is the corpus spelling (country, or region for Macau); `continent`
// matches data/countries.json where the country has content; `scope` marks the
// two countries the owner covered almost end to end.
export interface VisitedPlace { place: string; continent: 'Asia' | 'Europe' | 'North America' | 'Oceania'; scope?: 'most' | 'much'; region?: boolean }
export const EDITOR_VISITED: VisitedPlace[] = [
  { place: 'South Korea', continent: 'Asia', scope: 'most' },
  { place: 'Vietnam', continent: 'Asia', scope: 'much' },
  { place: 'Japan', continent: 'Asia' },
  { place: 'Singapore', continent: 'Asia' },
  { place: 'Thailand', continent: 'Asia' },
  { place: 'Laos', continent: 'Asia' },
  { place: 'Cambodia', continent: 'Asia' },
  { place: 'Indonesia', continent: 'Asia' },
  { place: 'Hong Kong', continent: 'Asia' },
  { place: 'Macau', continent: 'Asia' }, // own country since 2026-10-06
  { place: 'China', continent: 'Asia' },
  { place: 'Taiwan', continent: 'Asia' },
  { place: 'Mongolia', continent: 'Asia' }, // own country since 2026-10-11
  { place: 'France', continent: 'Europe' },
  { place: 'Spain', continent: 'Europe' },
  { place: 'Georgia', continent: 'Europe' },
  { place: 'Czech Republic', continent: 'Europe' },
  { place: 'Russia', continent: 'Europe' },
  { place: 'United States', continent: 'North America' },
  { place: 'Australia', continent: 'Oceania' },
  { place: 'New Zealand', continent: 'Oceania' },
];

const VISITED_COUNTRIES = new Set([
  ...EDITOR_VISITED.filter((v) => !v.region).map((v) => v.place),
  'Czechia', // alternate corpus spelling of Czech Republic
]);
// Hong Kong became its own country entry on 2026-08-13 (split from China);
// the region entries stay for legacy posts tagged region: Hong Kong/Macau.
const VISITED_REGIONS = new Set(['Hong Kong', 'Macau']);

export function editorHasTraveled(country?: string, region?: string): boolean {
  return (!!country && VISITED_COUNTRIES.has(country)) || (!!region && VISITED_REGIONS.has(region));
}
