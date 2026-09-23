// The "When is it quiet?" chart on a place guide, as data.
//
// What we HAVE is not a curve. BestTime gives us, per half of the week, a set
// of quiet hours and a set of busy hours (lib/busyness.mjs resolves overlaps:
// busy wins). Every other hour the venue is open is simply "neither". So the
// chart draws exactly three levels — quiet / normal / busy — and draws them
// only for hours the venue is open. A smooth line through those points would
// be a measurement we never took.
//
// Rows are split per half of the week (the page's Weekday / Weekend toggle),
// and inside a half, days only share a row when they agree on quiet, busy AND
// opening hours — every cell is a claim about every day named on its row.

import { perDayBusyness, resolveBusyness, DAY_NAMES } from './busyness.mjs';
import { openHourSetsByDay } from './hours.mjs';

// A venue's day starts in the morning, not at midnight: a bar open 18:00–02:00
// reads left to right as 18…23, 0, 1.
const DAY_START = 5;
const order = (h) => (h - DAY_START + 24) % 24;
const byClock = (a, b) => order(a) - order(b);

// Used only when the opening hours are unknown or unreadable — the same
// 7am–10pm window /tools/best-time/ draws, so the two never disagree.
const FALLBACK_HOURS = Array.from({ length: 16 }, (_, i) => i + 7);

const WEEKDAYS = DAY_NAMES.slice(0, 5);
const WEEKENDS = DAY_NAMES.slice(5);

/**
 * @typedef {{h: number, level: 'quiet' | 'mid' | 'busy' | 'closed'}} Cell
 * @typedef {{days: string[], quiet: number[], busy: number[], cells: Cell[]}} Row
 */

/** Cells from the first open hour to the last, in venue-day order. */
function cellsFor(open, quiet, busy) {
  const hours = [...open].sort(byClock);
  if (!hours.length) return [];
  const first = order(hours[0]);
  const last = order(hours[hours.length - 1]);
  const q = new Set(quiet), b = new Set(busy);
  const out = [];
  for (let o = first; o <= last; o++) {
    const h = (o + DAY_START) % 24;
    out.push({ h, level: !open.has(h) ? 'closed' : b.has(h) ? 'busy' : q.has(h) ? 'quiet' : 'mid' });
  }
  return out;
}

/**
 * @returns {{weekday: Row[], weekend: Row[]} | null} null when nothing was
 *   measured at all (no crowd block on the page).
 */
export function crowdRows(busyness, openingHours) {
  if (!busyness) return null;
  const perDay = perDayBusyness(busyness, openingHours);
  const openByDay = perDay ? openHourSetsByDay(openingHours) : null;

  const half = (days) => {
    if (!perDay || !openByDay) {
      // No readable week: one row per half, from the stored split.
      const r = resolveBusyness(busyness);
      const weekend = days === WEEKENDS;
      const quiet = weekend ? r.weekendQuiet : r.weekdayQuiet;
      const busy = weekend ? r.weekendBusy : r.weekdayBusy;
      if (!quiet.length && !busy.length) return [];
      return [{ days: [...days], quiet, busy, cells: cellsFor(new Set(FALLBACK_HOURS), quiet, busy) }];
    }
    const groups = new Map();
    for (const day of days) {
      const { quiet, busy } = perDay.get(day);
      const open = openByDay.get(day);
      // A closed day, or a day we measured nothing on, gets no row: an all-
      // "normal" bar is not a finding about the venue.
      if (!open.size || (!quiet.length && !busy.length)) continue;
      const key = [quiet.join(','), busy.join(','), [...open].sort((a, b) => a - b).join(',')].join('|');
      const g = groups.get(key);
      if (g) g.days.push(day);
      else groups.set(key, { days: [day], quiet, busy, cells: cellsFor(open, quiet, busy) });
    }
    return [...groups.values()];
  };

  const weekday = half(WEEKDAYS);
  const weekend = half(WEEKENDS);
  if (!weekday.length && !weekend.length) return null;
  return { weekday, weekend };
}

/**
 * One half's rows merged by what a sentence would say — rows that differ only
 * in opening hours share one "Quietest" line.
 * @param {Row[]} rows
 * @param {'quiet' | 'busy'} key
 * @returns {{days: string[], hours: number[]}[]}
 */
export function summaryLines(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const hours = [...r[key]];
    if (!hours.length) continue;
    const k = hours.join(',');
    const g = m.get(k);
    if (g) g.days.push(...r.days);
    else m.set(k, { days: [...r.days], hours });
  }
  return [...m.values()].map((g) => ({ days: DAY_NAMES.filter((d) => g.days.includes(d)), hours: g.hours }));
}
