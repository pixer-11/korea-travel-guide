import { quietDayGroups, dayGroupKind } from '../../src/lib/busyness.mjs';
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
  // "A, B and C", not "A and B and C". Three runs in one window is rare (14
  // guides) but it reads like a child listing toys, and the comma is free now
  // that groups are separated by "·" instead of by a comma of their own.
  const spans = runs.map(([a, b]) => `${a}:00-${b + 1}:00`);
  return spans.length > 1 ? `${spans.slice(0, -1).join(', ')} and ${spans.at(-1)}` : spans[0];
}

/** "weekdays 7:00-8:00 and 19:00-23:00 · weekends 9:00-11:00", or null. */
export function quietWindowSummary(busyness) {
  if (!busyness) return null;
  const parts = [];
  const wd = hourRuns24(busyness.weekdayQuiet);
  const we = hourRuns24(busyness.weekendQuiet);
  if (wd) parts.push(`weekdays ${wd}`);
  if (we) parts.push(`weekends ${we}`);
  return parts.length ? parts.join(' · ') : null;
}

// ── the days the quiet hours actually hold on ────────────────
// "Weekends" is one bucket to BestTime and two different days to a venue.
// Subhash Bose Park in Kochi is shut 9am-2pm on Saturday and opens at 11am on
// Sunday, so "quietest weekends 11am-2pm" sent a reader to a locked gate on one
// of the two days it named (Codex, 2026-09-21; 77 of 634 quiet pins).
//
// Intersecting the bucket would be truthful and lossy — the Met's 5pm really is
// quiet, on the Friday and Saturday it stays open until 9. So quietDayGroups()
// keeps the hours per day and groups the days that agree, and this names them.
// Nothing true is dropped; a fact that was hiding behind the word "weekdays"
// gets said out loud instead.

const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);

/** The English name for a set of days: null when it is the whole week. */
export function dayGroupLabel(days) {
  const k = dayGroupKind(days);
  if (k.kind === 'daily') return null;
  if (k.kind === 'weekdays') return 'weekdays';
  if (k.kind === 'weekends') return 'weekends';
  if (k.kind === 'except') return `every day but ${k.day}s`;
  return listOf(k.days.map((d) => `${d}s`));
}

/**
 * quietWindowSummary, but each run labelled with the days it is true on.
 * Falls back to the stored weekday/weekend split when there is no readable
 * week to check against — there is nothing to contradict then.
 * At most two groups: a third is a schedule too fiddly for one sentence. The
 * groups are separated by "·", not a comma, so a label that lists days of its
 * own ("Mondays, Wednesdays and Fridays") still reads as one claim.
 */
export function quietWindowSummaryWithinHours(busyness, openingHours) {
  const groups = quietDayGroups(busyness, openingHours);
  if (groups === null) return quietWindowSummary(busyness);
  const parts = [];
  for (const g of groups) {
    if (parts.length >= 2) break;
    const runs = hourRuns24(g.quiet);
    if (!runs) continue;
    const label = dayGroupLabel(g.days);
    parts.push(label ? `${label} ${runs}` : runs);
  }
  return parts.length ? parts.join(' · ') : null;
}