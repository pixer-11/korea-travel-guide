// ─────────────────────────────────────────────────────────────
//  REFRESH ORDER — who gets today's Place Details calls first
//
//  Never-checked posts go before any checked one; that part is unchanged.
//  What changed 2026-11-17: among the never-checked, the tie used to break by
//  FILENAME, so a July post called "seoul-…" or "tongyeong-…" waited behind
//  every newer post whose name sorted earlier. 557 venue posts had never been
//  re-checked, and the ones published 07-20 crossed validate-content's 120-day
//  STALE-RECHECK alarm while November posts were being served ahead of them.
//  The tie now breaks by publication date, oldest first — the post whose data
//  has gone longest without a look is the one most likely to be wrong.
//
//  Checked posts still tie-break by filename: they share a check date, so the
//  order between them is cosmetic, and filename keeps it stable.
// ─────────────────────────────────────────────────────────────

const iso = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString();
};

/**
 * @param {{file: string, pubDate?: string|Date}[]} candidates
 * @param {Record<string, string>} checked  filename → YYYY-MM-DD last checked
 * @returns the same array, sorted in place
 */
export function sortRefreshCandidates(candidates, checked) {
  return candidates.sort((a, b) => {
    const ca = checked[a.file] ?? '', cb = checked[b.file] ?? '';
    if (ca !== cb) return ca.localeCompare(cb);
    if (!ca) {
      // A post with no readable pubDate sorts first: unknown age is treated as
      // old, so it gets looked at instead of being parked behind everything.
      const pa = iso(a.pubDate), pb = iso(b.pubDate);
      if (pa !== pb) return pa.localeCompare(pb);
    }
    return a.file.localeCompare(b.file);
  });
}
