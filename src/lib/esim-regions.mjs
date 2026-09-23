// Region grouping for the eSIM guide index (/tools/esim/), 2026-09-24.
// An explicit map, not geography math: a country with an eSIM page and no row
// here would fall off the index, so esim-regions.test.mjs fails the build when
// any country in data/esim-facts.json (and active in countries.json) is missing.

export const ESIM_REGION_ORDER = ['eastAsia', 'southAsia', 'middleCentral', 'europeAmericas'];

/** @type {Record<string, string>} */
export const ESIM_REGION_OF = {
  // East Asia
  japan: 'eastAsia',
  'south-korea': 'eastAsia',
  china: 'eastAsia',
  taiwan: 'eastAsia',
  'hong-kong': 'eastAsia',
  // Southeast & South Asia
  thailand: 'southAsia',
  vietnam: 'southAsia',
  singapore: 'southAsia',
  malaysia: 'southAsia',
  indonesia: 'southAsia',
  philippines: 'southAsia',
  cambodia: 'southAsia',
  india: 'southAsia',
  // Middle East & Central Asia
  'united-arab-emirates': 'middleCentral',
  turkey: 'middleCentral',
  uzbekistan: 'middleCentral',
  // Europe & Americas
  france: 'europeAmericas',
  italy: 'europeAmericas',
  spain: 'europeAmericas',
  'united-states': 'europeAmericas',
};

/**
 * Carrier names for the small second line under each country. They are the one
 * genuinely per-country fact on the index. Descriptive asides written in English
 * ("True (merged with dtac)") are dropped so they do not leak into localized
 * pages; brand parentheticals like "au (KDDI)" stay.
 */
export function carrierLine(carriers) {
  if (!Array.isArray(carriers)) return '';
  return carriers
    .map((c) => String(c).replace(/\s*\((?:merged|formerly|now)\b[^)]*\)/i, '').trim())
    .filter(Boolean)
    .join(' · ');
}

/**
 * Group [{slug, ...}] into [{ region, countries }] in ESIM_REGION_ORDER; unknown slugs go last.
 * @template {{ slug: string }} T
 * @param {T[]} countries
 * @returns {{ region: string, countries: T[] }[]}
 */
export function groupByRegion(countries) {
  /** @type {Map<string, T[]>} */
  const buckets = new Map(ESIM_REGION_ORDER.map((r) => [r, /** @type {T[]} */ ([])]));
  /** @type {T[]} */
  const other = [];
  for (const c of countries) {
    const r = ESIM_REGION_OF[c.slug];
    (r ? buckets.get(r) ?? other : other).push(c);
  }
  const out = ESIM_REGION_ORDER.map((region) => ({ region, countries: buckets.get(region) ?? [] })).filter((g) => g.countries.length);
  // Never silently drop a country: an unmapped one still gets linked (the test
  // is what forces someone to give it a proper region).
  if (other.length) {
    if (out.length) out[out.length - 1].countries.push(...other);
    else out.push({ region: ESIM_REGION_ORDER[ESIM_REGION_ORDER.length - 1], countries: other });
  }
  return out;
}
