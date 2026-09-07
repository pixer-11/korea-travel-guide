// A sortable key from a frontmatter date, whichever shape it arrived in.
//
// `pubDate: '2026-07-26T07:56:04.606Z'` (quoted) reaches YAML as a STRING;
// `pubDate: 2026-07-26` (bare) reaches it as a DATE, and Astro's z.coerce.date()
// turns every one of them into a Date. The corpus holds both spellings — 1,290
// quoted and 118 bare on 2026-09-07 — so any comparison that does its own
// String() gets "Sun Jul 26 2026 16:56:04 GMT+0900" for some values and an ISO
// string for others, and sorts the first group by the ENGLISH NAME OF THE
// WEEKDAY. Two "newest first" sorts were doing exactly that: the day-trip hub's
// neighbour cards (26 of 27 hubs mis-ordered) and the Pinterest queue.
//
// One helper, so the next "newest first" is right by construction.
/** @param {unknown} v @returns {string} ISO-8601, or '' when there is no date */
export function dateKey(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  if (typeof v === 'number') return dateKey(new Date(v));
  const s = String(v ?? '').trim();
  if (!s) return '';
  const d = new Date(s);
  // Unparseable strings keep their own text: still deterministic, and never
  // silently equal to every other unparseable value.
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

/** Newest first. `sort(byNewest((p) => p.data.pubDate))` */
/** @param {(x: any) => unknown} pick */
export const byNewest = (pick) => (/** @type {any} */ a, /** @type {any} */ b) =>
  dateKey(pick(b)).localeCompare(dateKey(pick(a)));
