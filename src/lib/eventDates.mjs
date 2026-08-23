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
