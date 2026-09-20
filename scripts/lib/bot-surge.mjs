// Is the headline visit count a crowd, or a bot wave?
//
// The daily report leads with Cloudflare's count because ad blockers hide real
// people from Plausible, so Cloudflare is normally the truer volume. On
// 2026-09-18 and 09-19 that line read 7,498 and 6,125 visits — 90x the
// fortnight's average — while the people-with-behaviour line underneath stayed
// at 41 and 34, exactly where it had been all month. The owner read the
// headline and asked whether the traffic was real. It was not:
//
//   · pageviews ≈ visits (7,508 / 7,498): every session viewed one page and left;
//   · the top countries flipped to Brazil, Argentina and Pakistan overnight on a
//     site about Asian travel;
//   · Plausible, which only counts sessions that scroll, dwell or click, did not
//     move at all.
//
// None of that costs money or rankings — it is a reporting problem, and the fix
// is to say so in the line itself rather than let the owner reconcile two
// numbers by hand every morning.

/** Visits per behaviour-tracked visitor on an ordinary day, measured 09-07..09-14. */
const NORMAL_RATIO = 3.5;
/** Below this the numbers are too small to reason about (a quiet day is not a surge). */
const FLOOR = 300;

/**
 * @param {{visits:number, pageviews:number}} cf   Cloudflare totals
 * @param {{visitors:number}|null} pl              Plausible visitors (behaviour)
 * @returns {{suspect:boolean, ratio:number|null, perVisit:number|null, why:string|null}}
 */
export function botSurge(cf, pl) {
  const visits = Number(cf?.visits) || 0;
  const views = Number(cf?.pageviews) || 0;
  const people = Number(pl?.visitors) || 0;
  if (!visits || !people || visits < FLOOR) return { suspect: false, ratio: null, perVisit: null, why: null };

  const ratio = visits / people;
  const perVisit = views / visits;
  // Both signals must fire: a big gap on its own can be a blocker-heavy day, and
  // one page per visit on its own is normal for a small day of search traffic.
  if (ratio < NORMAL_RATIO * 2 || perVisit >= 1.2) return { suspect: false, ratio, perVisit, why: null };

  return {
    suspect: true,
    ratio,
    perVisit,
    why: `사람 1명당 방문 ${Math.round(ratio)}회, 방문당 ${perVisit.toFixed(2)}페이지`,
  };
}
