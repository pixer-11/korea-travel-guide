// Which side of "today" an event is on, in the browser, by the VENUE's date.
//
// The events hubs are built once a day on the UTC date and read in every time
// zone. The first fix (10-01) judged by the reader's own date, which is right
// for neither case Codex then found: a Los Angeles reader on 30 September saw
// a Korean festival that had opened on 1 October in Korea as "not yet", and
// an Asian reader at 01:00 lost a Hawaiian festival still on its last day in
// Honolulu. An event happens on its own calendar, so each list row and card
// carries data-tz (lib/venue-tz) and is judged against that zone's date. A
// row without a known zone falls back to the reader's date.
//
// The list, the hero's three numbers, the header line and the per-country
// counts all call evState(), so they cannot disagree again.
const DAY = 86_400_000;
const memo = new Map<string, number>();

/** Today's date, as a UTC day number, in the given IANA zone (reader's date when unknown). */
export function dayIn(tz?: string): number {
  const key = tz || '';
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const now = new Date();
  let n = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY;
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
      const v = Date.UTC(get('year'), get('month') - 1, get('day')) / DAY;
      if (Number.isFinite(v)) n = v;
    } catch { /* unknown zone: the reader's date */ }
  }
  memo.set(key, n);
  return n;
}

/** A date-only ISO string ("2026-10-01") as a UTC day number; NaN when absent. */
export const dayOf = (iso?: string) => (iso ? Date.parse(iso) / DAY : NaN);

export type EvState = 'soon' | 'on' | 'over';

/**
 * From data-start, data-end and data-tz. No start date ("date TBA") is still
 * to come; no end date is open-ended and never over — the build's groups and
 * hubStats treat it the same way (Codex C2, 10-01).
 */
export function evState(el: HTMLElement): EvState {
  const s = dayOf(el.dataset.start);
  if (!Number.isFinite(s)) return 'soon';
  const e = el.dataset.end ? dayOf(el.dataset.end) : Infinity;
  const t = dayIn(el.dataset.tz);
  return e < t ? 'over' : s > t ? 'soon' : 'on';
}

/** Has an event with this last day ended where it happens? No end date: never. */
export const isOver = (end?: string, tz?: string) => !!end && dayOf(end) < dayIn(tz);

/** Days from the venue's today to the event's last day (Infinity when open-ended). */
export function daysLeft(el: HTMLElement): number {
  const e = el.dataset.end ? dayOf(el.dataset.end) : Infinity;
  return e - dayIn(el.dataset.tz);
}
