// Closing days that a weekly opening-hours list cannot express.
//
// Google's hours say "Monday: Closed" for Shinjuku Gyoen, and that is all the
// itinerary page knew. On 2026-11-02 — a Monday — it warned "closed that day",
// and the garden was open: its official rules (fng.or.jp/shinjuku/en/) are
// "closed Mondays; if Monday is a national holiday, closed the next weekday;
// closed Dec 29 – Jan 3; open every day Mar 25 – Apr 24 and Nov 1 – 15". So the
// same page called 11-23 (a holiday Monday, open) closed and 11-24 (the Tuesday
// it actually shuts) open, and cried wolf all through cherry-blossom season.
//
// A venue's official rules live in data/venue-calendars.json, with a source and
// the day they were checked. This turns them into two short lists of dates for
// the next year — days the weekday rule says closed but the venue opens, and
// days the weekday rule says open but it shuts — which the page compares against
// the reader's arrival date. Built daily, so the window never runs out.

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const mdOf = (iso) => iso.slice(5);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayOf = (iso) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso, n) => { const d = dayOf(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };

/** Does the holiday list cover this date's year? (Any holiday dated that year.) */
const yearsCache = new WeakMap();
export function holidayYearKnown(iso, holidays) {
  if (!(holidays instanceof Set) || !holidays.size) return false;
  let years = yearsCache.get(holidays);
  if (!years) { years = new Set([...holidays].map((d) => String(d).slice(0, 4))); yearsCache.set(holidays, years); }
  return years.has(iso.slice(0, 4));
}

/** Is MM-DD inside [from, to] (inclusive, wrapping over the new year)? */
export function inRange(md, [from, to]) {
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

/**
 * Is the venue closed on this date under its official rules?
 * @param {string} iso  YYYY-MM-DD
 * @param {{closedWeekdays:string[], openDaily?:[string,string][], closedRanges?:[string,string][], holidayShift?:boolean}} rule
 * @param {Set<string>} holidays  national holidays (YYYY-MM-DD) of the venue's country
 */
export function closedOn(iso, rule, holidays = new Set()) {
  const md = mdOf(iso);
  if ((rule.closedRanges ?? []).some((r) => inRange(md, r))) return true;
  if ((rule.openDaily ?? []).some((r) => inRange(md, r))) return false;
  const regular = (d) => (rule.closedWeekdays ?? []).includes(WEEKDAYS[dayOf(d).getUTCDay()]);
  // The holiday shift needs that year's holidays. A year the data does not
  // reach keeps the plain weekday rule — never a guessed shift (Codex, 11-02:
  // the two-year window ran past Japan's 2027 list into 2028).
  if (!rule.holidayShift || !holidayYearKnown(iso, holidays)) return regular(iso);
  // "If Monday is a national holiday, closed on the next weekday": a regular
  // closing day that is a holiday opens, and the closure moves to the first
  // following day that is neither a holiday nor itself a regular closing day.
  if (regular(iso)) return !holidays.has(iso);
  if (holidays.has(iso)) return false;
  for (let back = 1; back <= 7; back++) {
    const prev = addDays(iso, -back);
    if (regular(prev)) {
      if (!holidays.has(prev)) return false; // the regular day was kept — no shift to carry
      // Every day between that holiday and today must have been a holiday too
      // (a Monday holiday followed by a Tuesday holiday shifts to Wednesday).
      for (let k = 1; k < back; k++) if (!holidays.has(addDays(iso, -k))) return false;
      // The shift lands only on a day the venue is not otherwise open daily.
      return !(rule.openDaily ?? []).some((r) => inRange(mdOf(prev), r));
    }
  }
  return false;
}

/**
 * The dates in [fromIso, fromIso + days) where the official rules disagree with
 * the plain weekday list.
 * @returns {{openOn:string[], closedOn:string[]}}
 */
export function calendarExceptions(rule, holidays, fromIso, days = 400) {
  const openOn = [];
  const closed = [];
  const regular = (d) => (rule.closedWeekdays ?? []).includes(WEEKDAYS[dayOf(d).getUTCDay()]);
  for (let i = 0; i < days; i++) {
    const d = addDays(fromIso, i);
    const truth = closedOn(d, rule, holidays);
    if (regular(d) && !truth) openOn.push(d);
    if (!regular(d) && truth) closed.push(d);
  }
  return { openOn, closedOn: closed };
}

/** National holidays for a country from data/country-facts.json's shape. */
export function holidaySet(countryFacts, country) {
  const list = countryFacts?.countries?.[country]?.holidays ?? [];
  return new Set(list.map((h) => h?.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))));
}
