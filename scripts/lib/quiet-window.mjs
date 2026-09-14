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
  return runs.map(([a, b]) => `${a}:00-${b + 1}:00`).join(' and ');
}

/** "weekdays 7:00-8:00 and 19:00-23:00, weekends 9:00-11:00", or null. */
export function quietWindowSummary(busyness) {
  if (!busyness) return null;
  const parts = [];
  const wd = hourRuns24(busyness.weekdayQuiet);
  const we = hourRuns24(busyness.weekendQuiet);
  if (wd) parts.push(`weekdays ${wd}`);
  if (we) parts.push(`weekends ${we}`);
  return parts.length ? parts.join(', ') : null;
}
