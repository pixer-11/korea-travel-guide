// One city, one region name.
//
// "Cebu City" next to "Cebu" (10-29) and "Iloilo City" next to seven "Iloilo"
// guides (11-12): event discovery wrote the city as the search spelled it, and
// the hub split in two. The validator caught both after the fact, and told the
// SEVEN established guides to adopt the newcomer's spelling, because it kept
// whichever spelling it happened to read first (file order: "iloilo-city-…"
// sorts before "iloilo-iloilo-…").
//
// Both sides now use this file: discovery adopts an existing spelling before
// the slug and title exist, and the validator names the spelling most live
// guides already carry.

// Case, spacing and a trailing "City" are what has split hubs so far. Except
// where "X City" and "X" are different places: a city and the province or
// country it shares a name with (Quezon City is in Metro Manila, Quezon
// province is not; Codex, 11-12). Those keep "city" in the key, so discovery
// never moves one onto the other and the validator never calls them twins.
const DISTINCT_CITY = new Set(['quezon city', 'mexico city', 'panama city', 'kuwait city', 'guatemala city', 'vatican city', 'belize city']);
export const regionSpellingKey = (r) => {
  const s = String(r ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  return DISTINCT_CITY.has(s) ? s : s.replace(/ city$/, '');
};

/**
 * country → key → Map(spelling → count), from posts with {country, region}.
 * @param {{country?: string, region?: string}[]} posts
 */
export function regionSpellings(posts) {
  const by = new Map();
  for (const p of posts) {
    if (!p?.region || !p?.country) continue;
    const keys = by.get(p.country) ?? by.set(p.country, new Map()).get(p.country);
    const key = regionSpellingKey(p.region);
    const counts = keys.get(key) ?? keys.set(key, new Map()).get(key);
    counts.set(p.region, (counts.get(p.region) ?? 0) + 1);
  }
  return by;
}

// The spelling with the most guides; on a tie, the one met first.
const majority = (counts) => [...counts].reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];

/** The spelling this country's guides already use for `city`, or `city` as given. */
export function adoptRegionSpelling(city, country, spellings) {
  const counts = spellings.get(country)?.get(regionSpellingKey(city));
  return counts?.size ? majority(counts) : city;
}

/**
 * Posts whose region is a minority spelling of a city that already has a
 * majority one: [{post, canonical}].
 */
export function spellingTwins(posts) {
  const spellings = regionSpellings(posts);
  const out = [];
  for (const p of posts) {
    if (!p?.region || !p?.country) continue;
    const counts = spellings.get(p.country).get(regionSpellingKey(p.region));
    if (counts.size < 2) continue;
    const canonical = majority(counts);
    if (p.region !== canonical) out.push({ post: p, canonical });
  }
  return out;
}
