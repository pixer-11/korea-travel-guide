// Which itineraries the HOME PAGE panel shows.
//
// The panel used to list every course alphabetically, with no cap — 10 rows
// already stood twice the height of the copy beside it, and the country relay
// (Cambodia, Macau, Australia, Georgia, Mongolia…) would have pushed it to
// 20-30. Owner (2026-08-21): show a handful, send the rest to "all
// itineraries". The rule, agreed:
//   • PINNED cities first (the high-search-volume flagships) — the same every
//     day, so a first visitor reads the product in half a second;
//   • then ROTATING slots, chosen deterministically per ISO week, so the
//     nightly builds stay identical inside a week but a returning visitor
//     sees a different city next week (and a new country gets its turn);
//   • one row per CITY: a city with 3-day and 5-day courses occupies one row
//     (link = shortest course; the others are named in the row's meta).
// Pure and dependency-free so it can be unit-tested.

/** Group itineraries by city, each group's courses sorted by days ascending. */
export function groupByCity(itins) {
  const by = new Map();
  for (const it of itins) {
    const city = it.data.city;
    if (!by.has(city)) by.set(city, { city, courses: [] });
    by.get(city).courses.push(it);
  }
  for (const g of by.values()) g.courses.sort((a, b) => Number(a.data.days) - Number(b.data.days));
  return [...by.values()];
}

/** ISO-ish week number used as the rotation seed (UTC, Monday-based). */
export function weekKey(now = new Date()) {
  const ms = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((ms - 4 * 864e5) / (7 * 864e5)); // 1970-01-05 was a Monday
}

/**
 * @param itins   the itinerary collection entries
 * @param opts    { pinned: string[] (city names, in display order), rotate: number, week: number }
 * @returns       city groups to render, pinned first then the week's rotation
 */
export function pickFeatured(itins, { pinned = [], rotate = 2, week = weekKey() } = {}) {
  const groups = groupByCity(itins);
  const byName = new Map(groups.map((g) => [g.city, g]));
  const head = pinned.map((c) => byName.get(c)).filter(Boolean);
  const rest = groups
    .filter((g) => !pinned.includes(g.city))
    .sort((a, b) => a.city.localeCompare(b.city));
  if (!rest.length || rotate <= 0) return head;
  const start = ((week % rest.length) + rest.length) % rest.length;
  const tail = [];
  for (let i = 0; i < Math.min(rotate, rest.length); i++) tail.push(rest[(start + i) % rest.length]);
  return [...head, ...tail];
}
