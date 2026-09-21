// The quiet-hours fact the itinerary writer is handed for each stop.
//
// It is a CLOSED-WORLD fact: the model is told to use nothing else, so whatever
// this line says is what a published itinerary will tell a traveller. It used
// to print the earliest quiet hour to the latest — a temple quiet at 7 and
// again from 19 to 22 became "weekdays 7:00-23:00", a promise of an empty
// temple straight through its busiest afternoon. The Best Time tool carried the
// same private shortcut and was wrong on 211 of 735 cards (2026-09-14).
//
// It also wrote "weekdays null" for a place with weekend data only, because the
// guard beside it checked for the string "undefined".

/** [7, 19, 20, 21, 22] → "7:00-8:00 and 19:00-23:00" */
export function hourRuns24(hours) {
  const xs = [...new Set(Array.isArray(hours) ? hours : [])]
    .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const runs = [];
  let start = xs[0];
  let prev = xs[0];
  for (const h of xs.slice(1)) {
    if (h === prev + 1) { prev = h; continue; }
    runs.push([start, prev]);
    start = h;
    prev = h;
  }
  runs.push([start, prev]);
  return runs.map(([a, b]) => `${a}:00-${b + 1}:00`).join(' and ');
}

/** "weekdays 7:00-8:00 and 19:00-23:00, weekends 9:00-11:00", or null. */
export function quietWindowSummary(busyness) {
  if (!busyness) return null;
  const parts = [];
  const wd = hourRuns24(busyness.weekdayQuiet);
  const we = hourRuns24(busyness.weekendQuiet);
  if (wd) parts.push(`weekdays ${wd}`);
  if (we) parts.push(`weekends ${we}`);
  return parts.length ? parts.join(', ') : null;
}

// ── does the venue's own schedule agree? ─────────────────────
// A quiet hour is only worth naming if the doors are open during it. BestTime
// buckets the week into "weekdays" and "weekends"; opening hours do not, and
// the two days inside a bucket often differ. Subhash Bose Park in Kochi is shut
// 9am-2pm on Saturday and opens at 11am on Sunday, so "quietest weekends
// 11am-2pm" sent a reader to a locked gate on one of the two days it named.
// Codex found it on 2026-09-21; 77 of the 634 quiet pins that have hours
// carried the same contradiction (Sagrada Família promised 6-8pm on a Saturday
// that closes at 6, Daegu National Museum 8am on a Saturday that opens at 9).
//
// The rule: an hour survives only when EVERY day of its bucket is open for the
// whole of it. A line we hold but cannot read counts as NOT open — a schedule
// we cannot parse is not permission to guess.

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAYS = DAY_NAMES.slice(0, 5);
const WEEKEND = DAY_NAMES.slice(5);

/**
 * One Google hours value → the open spans as hours past midnight, or null when
 * the line cannot be read. "Closed" is an empty list: readable, and never open.
 * @param {string} value e.g. "6:00 – 9:00 AM, 2:00 – 8:30 PM"
 */
export function openIntervals(value) {
  const v = String(value == null ? '' : value).trim();
  if (/^closed$/i.test(v)) return [];
  if (/^open\s*24\s*hours$/i.test(v)) return [[0, 24]];
  if (!v) return null;
  const spans = [];
  for (const span of v.split(',')) {
    const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*$/i.exec(span);
    if (!m) return null;
    const [, h1, min1, ap1, h2, min2, ap2] = m;
    // Google writes the meridiem once when both ends share it ("6:00 – 9:00
    // AM") and on the closing side alone for an afternoon span ("2:00 – 8:30
    // PM"), so a missing one is inherited — unless inheriting would invert the
    // span, which means the open side belongs to the morning.
    const to24 = (h, ap) => {
      const n = Number(h);
      if (!ap || !(n >= 1 && n <= 12)) return null;
      return ap.toUpperCase() === 'AM' ? (n === 12 ? 0 : n) : (n === 12 ? 12 : n + 12);
    };
    let a = to24(h1, ap1);
    let b = to24(h2, ap2);
    if (a === null && b === null) return null;
    if (a === null) {
      const inherited = to24(h1, ap2);
      a = inherited !== null && inherited <= b ? inherited : to24(h1, 'AM');
    }
    if (b === null) {
      const inherited = to24(h2, ap1);
      b = inherited !== null && inherited >= a ? inherited : to24(h2, 'PM');
    }
    if (a === null || b === null) return null;
    a += Number(min1 || 0) / 60;
    b += Number(min2 || 0) / 60;
    // "11:00 AM – 3:00 AM" and "7:00 AM – 12:00 AM" run past midnight. Reading
    // those as a backwards span made every late-night venue look shut all day.
    if (b <= a) b += 24;
    spans.push([a, b]);
  }
  return spans.length ? spans : null;
}

/** The seven weekdayDescriptions as day → spans (null where unreadable). */
function openHoursByDay(openingHours) {
  if (!Array.isArray(openingHours) || !openingHours.length) return null;
  const byDay = new Map(DAY_NAMES.map((d) => [d, null]));
  for (const line of openingHours) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(\S.*)$/.exec(String(line));
    if (!m) continue;
    const day = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    if (byDay.has(day)) byDay.set(day, openIntervals(m[2]));
  }
  return byDay;
}

/** Open for the whole of the hour starting at `h`? Unknown counts as no. */
const opensFor = (spans, h) => Array.isArray(spans)
  && spans.some(([a, b]) => (a <= h && h + 1 <= b) || (a <= h + 24 && h + 25 <= b));

/**
 * quietWindowSummary, minus every hour the venue is shut for on any day of the
 * bucket that would name it. With no schedule to check against there is nothing
 * to contradict, so the plain summary stands.
 */
export function quietWindowSummaryWithinHours(busyness, openingHours) {
  const byDay = openHoursByDay(openingHours);
  if (!byDay) return quietWindowSummary(busyness);
  if (!busyness) return null;
  const keep = (hours, days) => (Array.isArray(hours) ? hours : [])
    .filter((h) => Number.isInteger(h) && days.every((d) => opensFor(byDay.get(d), h)));
  return quietWindowSummary({
    weekdayQuiet: keep(busyness.weekdayQuiet, WEEKDAYS),
    weekendQuiet: keep(busyness.weekendQuiet, WEEKEND),
  });
}
