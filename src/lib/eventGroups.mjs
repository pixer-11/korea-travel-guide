// Which heading does an event card belong under on the events hubs?
//
// The hubs used to file every card under the month its run STARTS. A six-month
// exhibition that opened in June therefore sat under a "June 2026" heading at
// the top of the page in September — a bygone month above a list titled
// "Upcoming events" (found 2026-09-14). Long runs are the common case for
// museum shows, so this was not a one-post accident.
//
// Three groups instead:
//   'now'   — already started and not over: it is on TODAY.
//   'month' — has not started yet: file under its start month.
//   'tba'   — no usable start date.
//
// Callers hand in events they have already filtered with isEventPast(), so an
// event that started in the past is by definition still running.
const dayStr = (d) => d.toISOString().slice(0, 10);

const endValue = (data) => {
  const t = data?.eventEndDate ? new Date(data.eventEndDate).getTime() : NaN;
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

export function eventGroupOf(data, today = new Date()) {
  const raw = data?.eventStartDate;
  if (!raw) return { kind: 'tba' };
  const start = new Date(raw);
  if (Number.isNaN(start.getTime())) return { kind: 'tba' };
  return dayStr(start) <= dayStr(today) ? { kind: 'now' } : { kind: 'month', start };
}

// Returns [label, posts][] in reading order: what is on now, then each future
// month in the order the caller sorted them, then undated last.
/**
 * @param {any[]} posts
 * @param {{ now: string, tba: string, month: (d: Date) => string }} labels
 * @param {Date} [today]
 * @returns {Array<[string, any[]]>}
 */
export function groupUpcomingEvents(posts, labels, today = new Date()) {
  const now = [];
  const tba = [];
  const months = new Map();
  for (const p of posts ?? []) {
    const g = eventGroupOf(p?.data ?? {}, today);
    if (g.kind === 'now') now.push(p);
    else if (g.kind === 'tba') tba.push(p);
    else {
      const k = labels.month(g.start);
      (months.get(k) || months.set(k, []).get(k)).push(p);
    }
  }
  // Inside "on now" the caller's sort (soonest start first) puts the longest
  // run at the top, where it is the least urgent thing on the page. Order it by
  // what closes first instead: a show with three weeks left is worth a reader's
  // attention before one that runs until December.
  now.sort((a, b) => endValue(a?.data) - endValue(b?.data));

  return /** @type {Array<[string, any[]]>} */ ([
    ...(now.length ? [[labels.now, now]] : []),
    ...months,
    ...(tba.length ? [[labels.tba, tba]] : []),
  ]);
}
