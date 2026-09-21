import { openHourSetsByDay } from './hours.mjs';

// An hour cannot be quiet AND busy. When the source says both, busy wins.
//
// The stored data contradicts itself on 37 of 608 measured places (6.1%), all of
// them at the weekend: weekendQuiet and weekendBusy are derived independently
// from the venue's foot-traffic curve and can overlap at the shoulders. Lyon's
// Café Joyeux says quiet 9am-4pm and busy 11am-6pm; the hours 11-16 appear in
// both lists. Weekdays are clean (0 conflicts), so this is specific to how the
// weekend curve is folded.
//
// WHY BUSY WINS. The two errors are not symmetric. Telling a traveller a place
// is quiet when it is packed sends them at the worst possible hour — the exact
// failure this data exists to prevent. Telling them it is busy when it is calm
// only costs them an option they never knew they had. So the conservative read
// is the correct one.
//
// This lives in one place because three consumers need the same answer and were
// giving different ones: the crowd API (public, third parties integrate against
// it), the per-post page (printed "quiet 9am-5pm / busy 11am-7pm" side by side,
// which reads as broken), and the best-time heatmap — which already resolved it
// correctly, cell by cell, via `busy.has(h) ? 'busy' : quiet.has(h) ? …`. That
// implicit precedence is now explicit and shared.

/** @param {number[] | undefined} quiet @param {number[] | undefined} busy */
const without = (quiet, busy) => {
  if (!quiet?.length) return [];
  if (!busy?.length) return [...quiet];
  const drop = new Set(busy);
  return quiet.filter((h) => !drop.has(h));
};

/**
 * Resolve a stored busyness block into non-overlapping hour lists.
 *
 * Returns the same four fields, always as arrays. An hour claimed by both lists
 * is kept only in the busy one. Sorted, so callers can format ranges directly.
 *
 * @param {{weekdayQuiet?: number[], weekdayBusy?: number[], weekendQuiet?: number[], weekendBusy?: number[]} | null | undefined} b
 */
export function resolveBusyness(b) {
  const asc = (/** @type {number[]} */ xs) => [...xs].sort((x, y) => x - y);
  return {
    weekdayQuiet: asc(without(b?.weekdayQuiet, b?.weekdayBusy)),
    weekdayBusy: asc(b?.weekdayBusy ?? []),
    weekendQuiet: asc(without(b?.weekendQuiet, b?.weekendBusy)),
    weekendBusy: asc(b?.weekendBusy ?? []),
  };
}

/**
 * True when the stored block contradicts itself — an hour listed as both quiet
 * and busy. Used by the audit so the count can be tracked rather than silently
 * cleaned forever.
 *
 * @param {{weekdayQuiet?: number[], weekdayBusy?: number[], weekendQuiet?: number[], weekendBusy?: number[]} | null | undefined} b
 */
export function hasBusynessConflict(b) {
  const clash = (/** @type {number[] | undefined} */ q, /** @type {number[] | undefined} */ x) =>
    !!q?.length && !!x?.length && q.some((h) => x.includes(h));
  return clash(b?.weekdayQuiet, b?.weekdayBusy) || clash(b?.weekendQuiet, b?.weekendBusy);
}

// ── the week, day by day ─────────────────────────────────────
// The stored split is weekday/weekend, so every claim is one sentence about
// five days or two — and the days inside a bucket often keep different hours.
// Subhash Bose Park in Kochi is shut 9am-2pm on Saturday and opens at 11am on
// Sunday, so "quiet weekends 11am-2pm" sent a reader to a locked gate on one of
// the days it named. 77 of 634 measured places said something like it.
//
// Intersecting the bucket would be truthful and lossy: the Met's 5pm really is
// quiet, on the Friday and Saturday it stays open until 9. So the hours are
// kept per day and the days that agree are grouped — nothing true is dropped,
// and a fact hiding behind the word "weekdays" gets said out loud.

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Each day's resolved hours, with anything outside that day's own opening
 * hours removed.
 * @returns {Map<string, {quiet: number[], busy: number[]}> | null} null when
 *   there is no readable week to check against — the caller keeps the stored
 *   weekday/weekend split, because nothing contradicts it.
 */
export function perDayBusyness(busyness, openingHours) {
  const byDay = openHourSetsByDay(openingHours);
  if (!byDay || !busyness) return null;
  const r = resolveBusyness(busyness);
  const out = new Map();
  for (const day of DAY_NAMES) {
    const open = byDay.get(day);
    const keep = (/** @type {number[]} */ xs) => xs.filter((h) => open.has(((h % 24) + 24) % 24));
    const weekend = DAY_NAMES.indexOf(day) >= 5;
    out.set(day, {
      quiet: keep(weekend ? r.weekendQuiet : r.weekdayQuiet),
      busy: keep(weekend ? r.weekendBusy : r.weekdayBusy),
    });
  }
  return out;
}

/**
 * Group days that agree, biggest group first. `pick` chooses what must match.
 * A field the grouping did NOT key on is narrowed to the hours every day in the
 * group shares — grouping by quiet alone and then reporting the first day's busy
 * list would put Saturday's crowds on a Friday's row.
 */
function groupDays(perDay, pick) {
  const groups = new Map();
  for (const day of DAY_NAMES) {
    const d = perDay.get(day);
    const taken = pick(d);
    if (!taken.some((xs) => xs.length)) continue;
    const key = taken.map((xs) => xs.join(',')).join('|');
    const g = groups.get(key);
    if (!g) groups.set(key, { days: [day], quiet: d.quiet, busy: d.busy });
    else {
      g.quiet = g.quiet.filter((h) => d.quiet.includes(h));
      g.busy = g.busy.filter((h) => d.busy.includes(h));
      g.days.push(day);
    }
  }
  return [...groups.values()].sort((a, b) =>
    b.days.length - a.days.length
    || (b.quiet.length + b.busy.length) - (a.quiet.length + a.busy.length));
}

/**
 * Days grouped by the quiet hours they share — for a sentence that only talks
 * about quiet ("Quietest Fridays and Saturdays 5-6pm").
 * @returns {{days: string[], quiet: number[], busy: number[]}[] | null}
 */
export function quietDayGroups(busyness, openingHours) {
  const perDay = perDayBusyness(busyness, openingHours);
  return perDay && groupDays(perDay, (d) => [d.quiet]);
}

/**
 * Days grouped by BOTH their quiet and busy hours — for the hour bar, whose
 * every cell is a claim, so two days may only share a row when they agree
 * about all of it.
 * @returns {{days: string[], quiet: number[], busy: number[]}[] | null}
 */
export function busynessDayGroups(busyness, openingHours) {
  const perDay = perDayBusyness(busyness, openingHours);
  return perDay && groupDays(perDay, (d) => [d.quiet, d.busy]);
}

/**
 * Days grouped by the busy hours they share — for the sentence that only talks
 * about crowds. Kept separate from quietDayGroups so neither line is split by a
 * difference the other one cares about: grouping on both at once broke the Met
 * into four rows, none of which was about being quiet.
 * @returns {{days: string[], quiet: number[], busy: number[]}[] | null}
 */
export function busyDayGroups(busyness, openingHours) {
  const perDay = perDayBusyness(busyness, openingHours);
  return perDay && groupDays(perDay, (d) => [d.busy]);
}

/**
 * What a set of days should be called, as a shape the caller translates.
 * @returns {{kind: 'daily'} | {kind: 'weekdays'} | {kind: 'weekends'}
 *   | {kind: 'except', day: string} | {kind: 'list', days: string[]}}
 */
export function dayGroupKind(days) {
  const ds = DAY_NAMES.filter((d) => days.includes(d));
  if (ds.length === 7) return { kind: 'daily' };
  if (ds.length === 5 && DAY_NAMES.slice(0, 5).every((d) => ds.includes(d))) return { kind: 'weekdays' };
  if (ds.length === 2 && DAY_NAMES.slice(5).every((d) => ds.includes(d))) return { kind: 'weekends' };
  // Naming the one exception beats reciting six days.
  if (ds.length === 6) return { kind: 'except', day: DAY_NAMES.find((d) => !ds.includes(d)) };
  return { kind: 'list', days: ds };
}

const DAY_KEY = {
  Monday: 'day.mon', Tuesday: 'day.tue', Wednesday: 'day.wed', Thursday: 'day.thu',
  Friday: 'day.fri', Saturday: 'day.sat', Sunday: 'day.sun',
};

/**
 * The reader's name for a set of days. Abbreviations joined with "·" rather
 * than a conjunction: every language we publish in joins a short list that way,
 * so there is no "and"/"y"/"と" to get wrong, and it fits a table's row label.
 * @param {string[]} days
 * @param {(key: any) => string} t  useTranslations() types its key as the union
 *   of every known key, so a `(key: string) => string` parameter rejects it.
 */
export function dayGroupText(days, t) {
  const k = dayGroupKind(days);
  if (k.kind === 'daily') return t('post.daily');
  if (k.kind === 'weekdays') return t('post.weekdays');
  if (k.kind === 'weekends') return t('post.weekends');
  if (k.kind === 'except') return t('post.everyDayBut').replace('{day}', t(DAY_KEY[k.day]));
  return k.days.map((d) => t(DAY_KEY[d])).join('·');
}
