// Discovery asks the search model for "upcoming" events, and on 2026-10-08 it
// still returned four that were over (TWICE Turin 05-20, ATEEZ Rome 07-08,
// NCT 127 Frankfurt 09-14, MAMAMOO Hong Kong 10-01). Nothing checked the date
// in code, so each became a NEW guide — two of them telling readers the act
// "comes to" the city months after it left. A prompt is a request, not a gate.
//
// One day of slack: the event's own local date can be a day behind UTC.
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** True when the event's last day (end, else start) is before yesterday (UTC). Undated → false. */
export function isPastEvent(item, todayIso = new Date().toISOString().slice(0, 10)) {
  const last = ISO.test(String(item?.endDate ?? '')) ? item.endDate
    : ISO.test(String(item?.startDate ?? '')) ? item.startDate : '';
  if (!last) return false;
  const y = new Date(`${todayIso}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return last < y.toISOString().slice(0, 10);
}
