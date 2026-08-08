// Countries the site's editor has personally traveled (owner's own statement,
// 2026-08-08): Vietnam (extensively), Singapore, Thailand, South Korea (almost
// every region), the US, Australia, Laos, Cambodia, Indonesia, Hong Kong,
// Macau, China. This is the factual basis behind the "Editor-reviewed" line
// and the monthly picks' editor framing — a real person, not an invented
// persona. The badge speaks at COUNTRY level on purpose: having traveled a
// country does not claim every city in it.
const VISITED_COUNTRIES = new Set([
  'Vietnam', 'Singapore', 'Thailand', 'South Korea', 'United States',
  'Australia', 'Laos', 'Cambodia', 'Indonesia', 'China',
]);
// Hong Kong and Macau are stored as regions (country: China) in this corpus.
const VISITED_REGIONS = new Set(['Hong Kong', 'Macau']);

export function editorHasTraveled(country?: string, region?: string): boolean {
  return (!!country && VISITED_COUNTRIES.has(country)) || (!!region && VISITED_REGIONS.has(region));
}
