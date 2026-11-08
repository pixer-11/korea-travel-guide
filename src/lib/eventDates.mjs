// "Aug 9 – Sep 5" / "8月9日～9月5日": the short date range an event card
// wears. The home's monthly picks had this (HomePage.fmtEventDates); the
// events hubs showed month headers only, so a reader had to open the excerpt
// to learn when (UX audit 2026-08-23). One helper, both places.
export function fmtEventRange(start, end, locale = 'en') {
  if (!start) return '';
  const f = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const s = new Date(start);
  const e = new Date(end ?? start);
  if (Number.isNaN(s.getTime())) return '';
  if (Number.isNaN(e.getTime()) || s.getTime() === e.getTime()) return f.format(s);
  return `${f.format(s)} – ${f.format(e)}`;
}

// "October 3 – 4, 2026": the long form an event guide states itself. monthOnly
// stops at "February 2027" for events that only have a month (isMonthOnlyEvent).
export function fmtEventLong(start, end, locale = 'en', monthOnly = false) {
  try {
    const fmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', ...(monthOnly ? {} : { day: 'numeric' }), timeZone: 'UTC' });
    const s = new Date(start), e = new Date(end || start);
    const range = fmt.formatRange(s, e);
    // ICU writes a ja/zh RANGE numerically ("2026/10/03～2026/10/04") even
    // when asked for the long month; join two long dates instead.
    if (!/\//.test(range)) return range;
    const a = fmt.format(s), b = fmt.format(e);
    return a === b ? a : `${a}${locale.startsWith('zh') ? '至' : '～'}${b}`;
  } catch { return ''; }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A list of days running up to the month name. The writer's own style leads with
// weekdays, "Saturday 28 and Sunday 29 November" (12 of 869 event guides). A weekday
// or an ordinal proves these are dates, so those lists take every join. A plain "1"
// may be a bus, a gate or a session ("session 1, Wednesday 2 December", "Terminal 1
// through to 6 December"), and claiming the 1st there prints a day the guide never
// gave: it stays with the plain ranges, and a comma list needs "on" in front of it.
// Lists are capped: an open-ended repeat scans a long number list from every "1".
const WEEKDAY = '(?:Mon|Tues?|Wed(?:s|nes)?|Thu(?:rs?)?|Fri|Sat(?:ur)?|Sun)(?:day)?\\.?,?\\s+';
const NUM = '\\d{1,2}(?:st|nd|rd|th)?';
const ORDINAL = '\\d{1,2}(?:st|nd|rd|th)';
const LINK = '\\s*(?:,(?:\\s*(?:and|&))?|[-–—]|to|through(?:\\s+to)?|until|and(?:\\s+on)?|&)\\s*';
const WEEKDAY_LIST = `${WEEKDAY}(?:the\\s+)?0?1(?:st)?(?:${LINK}(?:${WEEKDAY})?(?:the\\s+)?${NUM}){0,12}`;
const ORDINAL_LIST = `1st(?:${LINK}(?:the\\s+)?${ORDINAL}){0,12}`;
const PLAIN_RANGE = `0?1(?:st)?(?:\\s*(?:[-–—]|to|through|until|and|&)\\s*${NUM})?`;
const ON_LIST = `(?<=\\b[Oo]n\\s+)0?1(?:,\\s*${NUM}){1,12},?\\s*(?:and|&)\\s*${NUM}`;

// Does the text name the 1st of this month: "December 1", "Dec. 1st", "1 December",
// "1-6 December", "Sunday 1, Monday 2 and Tuesday 3 December", "2026-12-01"?
// Month names only match capitalized, so "may 1" does not.
function namesFirstOfMonth(text, day) {
  const long = MONTHS[day.getUTCMonth()];
  const month = long === 'September' ? 'September|Sept?' : `${long}|${long.slice(0, 3)}`;
  const re = new RegExp(
    `\\b(?:${month})\\.?\\s+(?:the\\s+)?0?1(?:st)?(?!\\d)` +
    `|\\b(?:${WEEKDAY_LIST}|${ORDINAL_LIST}|${PLAIN_RANGE}|${ON_LIST})\\s+(?:of\\s+)?(?:${month})\\b`,
  );
  return re.test(text) || text.includes(day.toISOString().slice(0, 10));
}

// Some events only have a month. Discovery stores "December 2026" as 2026-12-01
// (sometimes through 12-31) while the guide says "in December 2026", so printing
// "December 1, 2026" at the top of the page would state a day the guide never
// claims (22 of 515 upcoming guides, 2026-11-08). True when the start is the 1st
// and the dates fill whole months, or the English body never names that day.
export function isMonthOnlyEvent(start, end, body) {
  if (!start) return false;
  const s = new Date(start);
  if (Number.isNaN(s.getTime()) || s.getUTCDate() !== 1) return false;
  const e = new Date(end ?? start);
  const dayAfterEnd = new Date(e.getTime() + 86_400_000);
  if (!Number.isNaN(e.getTime()) && dayAfterEnd.getUTCDate() === 1) return true;
  return !namesFirstOfMonth(String(body ?? ''), s);
}
