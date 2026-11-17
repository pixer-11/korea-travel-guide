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

const day = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
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
