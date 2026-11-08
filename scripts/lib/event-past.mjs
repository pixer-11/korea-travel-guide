// Discovery asks the search model for "upcoming" events, and on 2026-10-08 it
// still returned four that were over (TWICE Turin 05-20, ATEEZ Rome 07-08,
// NCT 127 Frankfurt 09-14, MAMAMOO Hong Kong 10-01). Nothing checked the date
// in code, so each became a NEW guide — two of them telling readers the act
// "comes to" the city months after it left. A prompt is a request, not a gate.
//
// One day of slack: the event's own local date can be a day behind UTC.
import { venueTimeZone } from '../../src/lib/venue-tz.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const lastDay = (item) => (ISO.test(String(item?.endDate ?? '')) ? item.endDate
  : ISO.test(String(item?.startDate ?? '')) ? item.startDate : '');

const shiftDay = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** True when the event's last day (end, else start) is before yesterday (UTC). Undated → false. */
export function isPastEvent(item, todayIso = new Date().toISOString().slice(0, 10)) {
  const last = lastDay(item);
  if (!last) return false;
  return last < shiftDay(todayIso, -1);
}

// The slack is only needed for a venue whose clock we cannot read. Five guides
// were born the day after their event had ended where it happened (La Plata,
// Tbilisi, Hong Kong, Singapore, Paris, 10-18 to 11-02): UTC-yesterday still
// read "not over". The search runs anywhere from 22:30 to 01:00 UTC, so no
// hour-of-day rule separates those from a Los Angeles show that is still on
// tonight. The venue's own date does (lib/evDay does the same on the page).
function todayAtVenue(country, city, now) {
  const tz = venueTimeZone(country, city);
  if (!tz) return null;
  try { return now.toLocaleDateString('en-CA', { timeZone: tz }); } catch { return null; }
}

/** Has the event's last day passed where it happens? Zone unknown → isPastEvent's slack. */
export function isOverAtVenue(item, country, now = new Date()) {
  const today = todayAtVenue(country, item?.city, now);
  if (!today) return isPastEvent(item, now.toISOString().slice(0, 10));
  const last = lastDay(item);
  return !!last && last < today;
}

// A one-off's page goes noindex the day after it ends (PostArticle's two
// tracks, on purpose), so a guide written on its last day or the day before is
// a writer and four translations for a page search never shows. The END
// decides, not the start: Mesa's Halloween Cup opened two days out and still
// earned Bing clicks, and a long exhibition can open tomorrow and run for
// weeks. Recurring events stay indexed after the date, so they are exempt.
/** One-off event whose last day is today or tomorrow at the venue (or already gone). */
export function endsTooSoon(item, country, now = new Date()) {
  if (item?.recurring === true) return false;
  const last = lastDay(item);
  if (!last) return false;
  const today = todayAtVenue(country, item?.city, now) ?? shiftDay(now.toISOString().slice(0, 10), -1);
  return last <= shiftDay(today, 1);
}
