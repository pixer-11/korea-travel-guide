// "Is anything shut while I'm there?" answered from two facts the site already
// holds: dated public holidays per country (data/country-facts.json) and each
// venue's ordinary weekly hours from Google Places.
//
// What this deliberately does NOT know is holiday opening hours. A public holiday
// falling inside a range is a fact; "the museum will be closed for it" is a guess,
// and guesses dressed as findings are what the 2026-09 repairs removed.
//
// Data arrives as arguments rather than being imported, so these stay pure
// functions testable in plain node — the same contract as when-to-go.mjs.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Nobody plans a 60-day range, and an unbounded loop on bad input is how a build
// hangs. The cap is a guard, not a product rule.
const MAX_DAYS = 60;

const utc = (iso) => (ISO.test(String(iso)) ? Date.parse(`${iso}T00:00:00Z`) : NaN);

/** Every date from `fromISO` to `toISO` inclusive, ascending. `[]` on bad input. */
export function eachDateInRange(fromISO, toISO) {
  const a = utc(fromISO); const b = utc(toISO);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const out = [];
  for (let t = a; t <= b && out.length < MAX_DAYS; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** The weekday name for an ISO date, read in UTC so it cannot shift by timezone. */
export function weekdayOf(iso) {
  const t = utc(iso);
  return Number.isNaN(t) ? null : DAYS[new Date(t).getUTCDay()];
}

/** Public holidays of `country` inside the range, ascending. */
export function holidaysInRange(countryFacts, country, fromISO, toISO) {
  const a = utc(fromISO); const b = utc(toISO);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return [];
  const facts = (countryFacts?.countries ?? countryFacts ?? {})[country];
  return (facts?.holidays ?? [])
    .filter((h) => {
      const t = utc(h?.date);
      return !Number.isNaN(t) && t >= a && t <= b;
    })
    .sort((x, y) => x.date.localeCompare(y.date));
}

// Google writes one line per weekday: "Monday: 9:00 AM – 5:00 PM" or
// "Monday: Closed". Anything else is somebody else's format and is left alone
// rather than guessed at.
const CLOSED_LINE = /^\s*(\w+day)\s*:\s*closed\s*$/i;

/** Weekday names this venue is ordinarily shut. `[]` when we should not say. */
export function closedWeekdaysOf(post) {
  const place = post?.data?.place;
  if (!place || place.hoursOmitted) return [];
  return (place.openingHours ?? [])
    .map((line) => CLOSED_LINE.exec(String(line))?.[1])
    .filter(Boolean)
    .map((d) => d[0].toUpperCase() + d.slice(1).toLowerCase())
    .filter((d) => DAYS.includes(d));
}

/**
 * For each date in the range with at least one covered venue shut, the venues.
 * Dates ascending, venues by name, so the same input always renders the same page.
 */
export function closuresInRange(posts, { country, fromISO, toISO } = {}) {
  const dates = eachDateInRange(fromISO, toISO);
  if (!dates.length || !Array.isArray(posts)) return [];

  const byWeekday = new Map();
  for (const p of posts) {
    if (p?.data?.country !== country) continue;
    const closed = closedWeekdaysOf(p);
    if (!closed.length) continue;
    const venue = {
      slug: String(p.id ?? '').replace(/\.md$/, ''),
      name: p.data.place?.name ?? String(p.data.title ?? '').split(':')[0].trim(),
      city: p.data.region ?? null,
    };
    for (const d of closed) {
      if (!byWeekday.has(d)) byWeekday.set(d, []);
      byWeekday.get(d).push(venue);
    }
  }
  for (const list of byWeekday.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  return dates
    .map((date) => ({ date, weekday: weekdayOf(date), venues: byWeekday.get(weekdayOf(date)) ?? [] }))
    .filter((d) => d.venues.length > 0);
}
