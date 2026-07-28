// "Is March a good time for Japan?" answered from data the site already holds:
// 30-year climate normals from Open-Meteo, public holidays, and the venues we
// have published. Nothing here is generated prose — every claim is a computed
// fact, so these pages can be built unattended without anyone checking them.
//
// The unit of the page is COUNTRY × MONTH rather than city × month, because
// climate normals exist per country at full coverage (17/17) while the venue
// catalogue averages under three guides per city. Building the finer grid would
// mean padding, and padded template pages are what search engines drop first.

// Data comes in as arguments rather than being imported here: Astro resolves a
// JSON import happily, plain Node needs an import attribute, and a module that
// cannot be exercised outside the build is a module nobody tests. These stay
// pure functions over data the caller loads.

export const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const MONTH_SLUGS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export const monthSlug = (m) => MONTH_SLUGS[m - 1];
export const monthFromSlug = (slug) => MONTH_SLUGS.indexOf(String(slug).toLowerCase()) + 1 || null;

/** Countries with a full 12-month climate record — the rest get no page at all. */
export function eligibleCountries(countryFacts) {
  const all = countryFacts?.countries ?? countryFacts ?? {};
  return Object.entries(all)
    .filter(([, f]) => (f.climate ?? []).length === 12)
    .map(([name]) => name)
    .sort();
}

const rank = (values, target, dir) => {
  // 1 = most extreme in `dir`. Ties share the better rank, which is what a reader
  // means by "the third wettest month".
  const sorted = [...values].sort((a, b) => (dir === 'desc' ? b - a : a - b));
  return sorted.indexOf(target) + 1;
};

/**
 * Everything one country-month page needs. Pure: same inputs, same output.
 * Returns null when the country has no usable climate record.
 */
export function whenToGo(country, month, { countryFacts, events = [], posts = [] } = {}) {
  const facts = (countryFacts?.countries ?? countryFacts ?? {})[country];
  const climate = facts?.climate ?? [];
  if (climate.length !== 12) return null;

  const here = climate.find((c) => c.m === month);
  if (!here) return null;

  const highs = climate.map((c) => c.hi);
  const rains = climate.map((c) => c.rain);
  const yearRain = rains.reduce((a, b) => a + b, 0);

  // Holidays inside this month, in any year the dataset covers, de-duplicated by
  // name so "New Year's Day" doesn't appear once per year on the same page.
  const seen = new Set();
  const holidays = (facts.holidays ?? [])
    .filter((h) => Number(h.date.slice(5, 7)) === month)
    .filter((h) => (seen.has(h.name) ? false : (seen.add(h.name), true)))
    .sort((a, b) => a.date.localeCompare(b.date));

  const monthEvents = (Array.isArray(events) ? events : events?.events ?? [])
    .filter((e) => e.country === country && (e.months ?? []).includes(month));

  // Venues we can actually show for this country, best-rated first. Quiet-hours
  // venues lead: they are the thing no other travel site can print.
  const countryPosts = posts.filter((p) => (p.data.country ?? 'South Korea') === country);
  const withCrowd = countryPosts.filter((p) => p.data.place?.busyness);
  const score = (p) =>
    (p.data.place?.rating ?? 0) * Math.log10((p.data.place?.userRatingsTotal ?? 0) + 10);

  return {
    country,
    month,
    hi: here.hi,
    lo: here.lo,
    rain: here.rain,
    // Where this month sits in the year — the comparison a traveller is making.
    heatRank: rank(highs, here.hi, 'desc'),
    rainRank: rank(rains, here.rain, 'desc'),
    driest: rank(rains, here.rain, 'asc') === 1,
    coolest: rank(highs, here.hi, 'asc') === 1,
    hottest: rank(highs, here.hi, 'desc') === 1,
    wettest: rank(rains, here.rain, 'desc') === 1,
    // Share of the year's rain that falls this month, rounded — a monsoon month
    // is obvious in this number in a way that millimetres alone are not.
    rainShare: yearRain ? Math.round((here.rain / yearRain) * 100) : 0,
    climate,
    holidays,
    events: monthEvents,
    topVenues: [...countryPosts].sort((a, b) => score(b) - score(a)).slice(0, 8),
    quietVenues: [...withCrowd].sort((a, b) => score(b) - score(a)).slice(0, 6),
    venueCount: countryPosts.length,
  };
}
