// Quotable statistics over the public crowd dataset (/api/crowd.json).
//
// Why this exists: on 2026-09-09 a journalist answer was drafted from numbers
// computed by hand in a throwaway node -e. That is fine once and a liability
// every week after — a press quote is the one place a wrong number cannot be
// quietly edited later. So the arithmetic lives here, with tests.
//
// It also refuses one specific mistake. City-level averages LOOK like the most
// quotable number in the set ("Kyoto is busier than Kanazawa") and are not:
// venue counts per city run from 1 to 13 and the venues were chosen by which
// guides exist, not by sampling. On the real 2026-09-09 file that made Rome
// (n=5, mean 0.2 busy weekday hours) read calmer than Kanazawa (n=6, 2.83),
// which is an artefact of which five Roman venues we happen to cover. cityRollup
// therefore returns quotable:false and the reason, so the next caller has to
// read why before it can misuse it.

// A venue is "quiet in the morning" if any of its reliably quiet weekday hours
// falls in [MORNING_FROM, MORNING_TO] inclusive, on the venue's local clock.
export const MORNING_FROM = 7;
export const MORNING_TO = 11;

// Below this many venues a city's mean says more about our coverage than about
// the city. Chosen from the real distribution: cities range 1..13 venues, so no
// threshold makes these comparable — the constant marks the floor at which the
// number is not even worth computing.
export const MIN_CITY_SAMPLE = 4;

const hours = (v) => (Array.isArray(v) ? v : []);

/** Venues, countries, and the freshness window of the underlying measurements. */
export function coverage(places) {
  const countries = new Set();
  const dates = [];
  for (const p of places) {
    if (p.country) countries.add(p.country);
    if (p.measured) dates.push(p.measured);
  }
  dates.sort();
  return {
    venues: places.length,
    countries: countries.size,
    measuredFrom: dates[0] ?? null,
    measuredTo: dates[dates.length - 1] ?? null,
  };
}

/**
 * The morning claim: of the venues that HAVE reliably quiet weekday hours, how
 * many have one in the morning window. The denominator is deliberately the
 * venues with data, not all venues — quoting it against all venues would let a
 * venue with no quiet hours at all count as evidence against mornings.
 */
export function morningQuiet(places) {
  const withData = places.filter((p) => hours(p.weekdayQuiet).length > 0);
  const inWindow = withData.filter((p) =>
    hours(p.weekdayQuiet).some((h) => h >= MORNING_FROM && h <= MORNING_TO),
  );
  return {
    withQuietWeekdayHours: withData.length,
    quietInMorning: inWindow.length,
    share: withData.length ? inWindow.length / withData.length : null,
    window: [MORNING_FROM, MORNING_TO],
  };
}

/** The most common reliably-busy weekday hour, and how many venues share it. */
export function peakBusyHour(places) {
  const tally = new Map();
  let withData = 0;
  for (const p of places) {
    const hs = hours(p.weekdayBusy);
    if (!hs.length) continue;
    withData++;
    for (const h of hs) tally.set(h, (tally.get(h) ?? 0) + 1);
  }
  if (!withData) return { hour: null, venues: 0, withBusyWeekdayHours: 0 };
  // Ties break to the earlier hour so the answer is stable across refreshes.
  let best = null;
  for (const [h, n] of [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    best = { hour: h, venues: n };
    break;
  }
  return { ...best, withBusyWeekdayHours: withData };
}

/** One named venue's hours, for quoting a specific place rather than an average. */
export function venue(places, name) {
  const needle = String(name).toLowerCase();
  const hit = places.find((p) => String(p.name ?? '').toLowerCase() === needle)
    ?? places.find((p) => String(p.name ?? '').toLowerCase().includes(needle));
  if (!hit) return null;
  return {
    name: hit.name,
    city: hit.city,
    country: hit.country,
    weekdayQuiet: hours(hit.weekdayQuiet),
    weekdayBusy: hours(hit.weekdayBusy),
    weekendQuiet: hours(hit.weekendQuiet),
    weekendBusy: hours(hit.weekendBusy),
    measured: hit.measured,
  };
}

/**
 * City means — computed, but never quotable. See the header. The shape carries
 * its own refusal so a caller cannot pick the numbers out without the reason.
 */
export function cityRollup(places) {
  const byCity = new Map();
  for (const p of places) {
    if (!p.city) continue;
    if (!byCity.has(p.city)) byCity.set(p.city, []);
    byCity.get(p.city).push(p);
  }
  const cities = [...byCity]
    .map(([city, vs]) => ({
      city,
      venues: vs.length,
      meanBusyWeekdayHours: vs.reduce((s, v) => s + hours(v.weekdayBusy).length, 0) / vs.length,
    }))
    .sort((a, b) => b.meanBusyWeekdayHours - a.meanBusyWeekdayHours);
  const counts = cities.map((c) => c.venues);
  return {
    quotable: false,
    reason:
      `Venue counts per city run ${Math.min(...counts)}–${Math.max(...counts)} and the venues were ` +
      'chosen by which guides exist, not by sampling, so these means rank our coverage rather than ' +
      'the cities. Quote a named venue instead.',
    minSampleForAnyUse: MIN_CITY_SAMPLE,
    cities,
  };
}

/** Everything a pitch or press answer may quote, in one object. */
export function quotableStats(places) {
  return {
    coverage: coverage(places),
    morningQuiet: morningQuiet(places),
    peakBusyHour: peakBusyHour(places),
  };
}
