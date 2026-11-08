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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Does the text name the 1st of this month: "December 1", "Dec. 1st", "1 December",
// "1-6 December", "2026-12-01"? Month names only match capitalized, so "may 1" does not.
function namesFirstOfMonth(text, day) {
  const long = MONTHS[day.getUTCMonth()];
  const month = long === 'September' ? 'September|Sept?' : `${long}|${long.slice(0, 3)}`;
  const re = new RegExp(
    `\\b(?:${month})\\.?\\s+0?1(?:st)?(?!\\d)` +
    `|\\b0?1(?:st)?(?:\\s*(?:[-–—]|to|and|&)\\s*\\d{1,2}(?:st|nd|rd|th)?)?\\s+(?:of\\s+)?(?:${month})\\b`,
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
