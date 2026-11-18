// ─────────────────────────────────────────────────────────────
//  REFRESH ORDER — who gets today's Place Details calls first
//
//  The post whose venue data has gone longest without a look goes first. "A
//  look" is the last re-check if there was one, and the publication date if
//  there was not: a post is written from Place Details fetched that day.
//
//  That is the clock validate-content's 120-day STALE-RECHECK alarm reads
//  (cursor date, else the post's own date), and the order has to run on the
//  same clock or the alarm fires on a rotation that is working:
//
//  2026-11-17  Never-checked posts went first, tie broken by FILENAME, so a
//              July post called "seoul-…" waited behind every newer post whose
//              name sorted earlier. Six posts published 07-20 crossed the
//              alarm while November posts were served ahead of them. The tie
//              was changed to publication date.
//  2026-11-18  Still two queues: every never-checked post, however new, went
//              before every checked one, however old. 522 never-checked posts
//              at 35 a day is 15 days, and the post checked on 08-02 crosses
//              120 days on 11-30 — a simulated run of the 11-17 order raised
//              the alarm on 11-30..12-03 for it, behind posts published last
//              week. One queue now, by the date of the last look. Simulated
//              over 400 days on the real posts: no alarm day at 35 or 30 a
//              day, with or without one day a week lost to quota.
//
//  Ties break by filename, which keeps the order stable between runs.
// ─────────────────────────────────────────────────────────────

// A date → 'YYYY-MM-DD' the way validate-content's isoDay reads it: a Date by
// its UTC day, a string by its first ten characters. Converting a quoted
// '2026-07-20T23:30:00-05:00' to UTC would call it 07-21 here and 07-20 at the
// alarm, and a day's disagreement is a post served one run late (Codex,
// 2026-11-18; no such pubDate in the corpus that day).
const day = (d) => {
  if (!d) return '';
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  const s = String(d);
  return /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(new Date(s.slice(0, 10)).getTime()) ? s.slice(0, 10) : '';
};

/**
 * The day this post's venue data was last looked at, YYYY-MM-DD.
 * '' when it has no re-check and no readable pubDate: unknown age is treated
 * as oldest, so the post gets looked at instead of being parked behind
 * everything.
 */
export function lastLooked(candidate, checked) {
  return day(checked[candidate.file]) || day(candidate.pubDate);
}

// How long one pass over the venue posts takes at `perDay` re-checks. The order
// above keeps the alarm quiet only while this stays under the alarm's 120 days,
// and the catalogue grows every day while the share is a constant somebody
// typed: on 2026-11-17 the pass was 132 days and nothing had said so until the
// alarm itself went off. validate-content raises ROTATION-SLOW past
// ROTATION_WARN_DAYS, which at 35 a day is 700 posts — months — of notice.
export const ROTATION_WARN_DAYS = 100;
export function rotationDays(venuePosts, perDay) {
  return perDay > 0 ? Math.ceil(venuePosts / perDay) : Infinity;
}

/**
 * @param {{file: string, pubDate?: string|Date}[]} candidates
 * @param {Record<string, string>} checked  filename → YYYY-MM-DD last checked
 * @returns the same array, sorted in place
 */
export function sortRefreshCandidates(candidates, checked) {
  return candidates.sort((a, b) => {
    const la = lastLooked(a, checked), lb = lastLooked(b, checked);
    if (la !== lb) return la.localeCompare(lb);
    return a.file.localeCompare(b.file);
  });
}
