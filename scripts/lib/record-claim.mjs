// Does a sentence the auditor called "invented" only repeat the post's own record?
//
// 2026-10-11: the weekly editor check is handed opening hours, price level,
// rating and crowd hours (full-content-audit verifiedBlock) — not the address,
// and for an event nothing at all, because an event has no `place`. So it
// reported the venue's own address ("The building sits at 182 Aberdeen Main
// Road", from place.address) and the event's own dates ("The 2026 festival is
// on Saturday, December 12", from eventStartDate) as invented, and repair-prose
// hedged true facts away: of 301 number-quoting "invented-specifics" findings
// in the queue, 162 carried only numbers from the post's own record.
//
// Deterministic and narrow, like crowd-claim.mjs: a quote is backed only when
// it contains the record's street address, or when every date it states falls
// on the event's own days and every number in it is one of those days or years.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ABBR = [[/\broad\b/g, 'rd'], [/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\bboulevard\b/g, 'blvd'], [/\bdrive\b/g, 'dr'], [/\blane\b/g, 'ln']];
const norm = (s) => ABBR.reduce((t, [re, to]) => t.replace(re, to), String(s).toLowerCase().replace(/[.,]/g, ' ')).replace(/\s+/g, ' ').trim();

/** The street part of an address: its first comma-separated segment, if it carries a number. */
function streetOf(address) {
  const first = String(address || '').split(',')[0].trim();
  return /\d/.test(first) && first.length >= 6 ? norm(first) : '';
}

const iso = (v) => (v instanceof Date ? v.toISOString() : String(v || '')).slice(0, 10);

/** Every day of the event, as {y, m (1-12), d}. Empty when the post has no event dates. */
function eventDays(data) {
  const a = iso(data.eventStartDate), b = iso(data.eventEndDate) || a;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return [];
  const out = [];
  for (let t = Date.parse(`${a}T00:00:00Z`), end = Date.parse(`${b}T00:00:00Z`); t <= end && out.length < 60; t += 86400e3) {
    const d = new Date(t);
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
  }
  return out;
}

/**
 * @param {string} quote  the sentence the auditor flagged
 * @param {object} data   the post's frontmatter
 */
// What is left once the record's own words are taken out must say nothing new.
// An allow-list, not a list of claim words: a deny-list let "lunch includes
// lobster", "gates shut at noon" and "dinner is twenty dollars" ride through
// on the back of a true address or date (Codex, 10-11, twice). The rest may
// hold only words that place or schedule ("The building sits at", "The 2026
// festival is on Saturday") and the post's own names (title, venue, region).
const FRAME = new Set(('the a an it its this that these those is are was were be been will '
  + 'sits sit located lies stands found set held hold holds takes take took place runs run ran '
  + 'scheduled planned announced falls fall date dates day days edition year at on in of for from '
  + 'to and or between by near along off address street road building venue site event festival '
  + 'show shows concert concerts tour race match game games two three both first second final '
  + 'square park temple museum market hall arena stadium centre center city district gate '
  + 'monday tuesday wednesday thursday friday saturday sunday weekend').split(' '));
const words = (s) => String(s || '').toLowerCase().match(/[a-z]+/g) || [];
const quiet = (rest, data) => {
  if (/\d|[$€£¥₩]/.test(rest)) return false;
  const own = new Set([data.title, data.place?.name, data.eventVenue, data.region].flatMap(words));
  return words(rest).every((w) => FRAME.has(w) || own.has(w));
};

export function recordBacksQuote(quote, data) {
  const q = String(quote || '');
  if (!q || !data) return false;
  const street = streetOf(data.place?.address);
  if (street) {
    const n = norm(q);
    const at = n.search(new RegExp(`(?:^|[^0-9a-z])${street.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9a-z])`));
    if (at >= 0) {
      const start = n[at] === street[0] ? at : at + 1;
      if (quiet(n.slice(0, start) + ' ' + n.slice(start + street.length), data)) return true;
    }
  }

  const days = eventDays(data);
  if (!days.length) return false;
  // With a year, the whole date must be an event day: for Dec 31, 2026 to
  // Jan 1, 2027, "January 1, 2026" names a day a year early (Codex, 10-15).
  const onEventDay = (m, d, y) => days.some((x) => x.m === m && x.d === d && (!y || x.y === y));
  const years = new Set(days.map((x) => x.y));
  // "December 12", "December 12-13", "December 12, 2026" — month, day(s), year.
  const DATE = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?(?:,?\s+(\d{4}))?/gi;
  let any = false, ok = true;
  const rest = q.replace(DATE, (_, mon, d1, d2, y) => {
    any = true;
    const m = MONTHS.indexOf(mon.toLowerCase()) + 1;
    const yr = y ? Number(y) : 0;
    if (!onEventDay(m, Number(d1), yr) || (d2 && !onEventDay(m, Number(d2), yr))) ok = false;
    return ' ';
  }).replace(/\b(\d{4})\b/g, (y) => (years.has(Number(y)) ? ' ' : y));
  return any && ok && quiet(rest, data);
}

/** The record lines the editor check should see as facts (address and event). */
export function recordFactLines(data) {
  const lines = [];
  if (data?.place?.address) lines.push(`address: ${data.place.address}`);
  const a = iso(data?.eventStartDate), b = iso(data?.eventEndDate);
  if (/^\d{4}-/.test(a)) lines.push(`event dates: ${a}${b && b !== a ? ` to ${b}` : ''}`);
  if (data?.eventVenue) lines.push(`event venue: ${data.eventVenue}`);
  if (data?.eventOrganizer?.name) lines.push(`organizer: ${data.eventOrganizer.name}`);
  if (data?.eventPerformer?.name) lines.push(`performer: ${data.eventPerformer.name}`);
  return lines;
}
