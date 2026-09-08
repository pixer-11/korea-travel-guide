// Photo-backfill queue ordering — pure, no I/O.
//
// Measured 2026-09-07 with Search Console: ~137 posts sit in quarantine
// (draft:true, no verified photo) and the nightly backfill patrol works
// through them in whatever order `readdir` hands back — alphabetical
// accident. Over the last four weeks, 4 of the site's 17 total clicks landed
// on quarantined pages that then 302 away; the single best is
// `/zh/posts/yeosu-bokchun-restaurant/` at 3 clicks, position 4.3, CTR 100% —
// the best-performing page on the whole site, and it doesn't resolve.
// The quarantine is correct (stock photos, wrong buildings) — this module
// does not release anything. It only decides WHICH draft gets tonight's
// attempt first, so real Search Console earnings jump the alphabetical queue.
//
// `perf` is the `pages` object from data/gsc-page-performance.json: a plain
// object keyed by slug, `{ clicks, impressions, position }` per entry
// (position is the best/lowest across languages). A slug absent from `perf`
// is treated as zero clicks/zero impressions/no position.
export function orderPhotoQueue(slugs, perf) {
  const data = perf && typeof perf === 'object' ? perf : {};
  return slugs
    .map((slug, index) => ({ slug, index, row: data[slug] }))
    .sort((a, b) => {
      const ac = a.row?.clicks ?? 0, bc = b.row?.clicks ?? 0;
      if (bc !== ac) return bc - ac;
      const ai = a.row?.impressions ?? 0, bi = b.row?.impressions ?? 0;
      if (bi !== ai) return bi - ai;
      // Position: lower is better. Missing position (no row at all) sorts
      // after any real position, since it means "never seen in search."
      const ap = a.row?.position, bp = b.row?.position;
      if (ap != null && bp != null && ap !== bp) return ap - bp;
      if (ap != null && bp == null) return -1;
      if (ap == null && bp != null) return 1;
      // Full tie (including both-absent-from-perf): keep original order —
      // this is what makes the result deterministic and keeps no-data slugs
      // in their existing relative order at the back of the queue.
      return a.index - b.index;
    })
    .map((x) => x.slug);
}

// How many failed nights before a slug stops taking a slot every night, and how
// often it is looked at after that.
export const GIVE_UP_AFTER = 7;
export const RECHECK_EVERY = 30;

/**
 * Should tonight's run skip this slug?
 *
 * The give-up threshold existed and was only ANNOUNCED: the run printed
 * "search paused" at the end and queued the same slug again the next night.
 * Measured 2026-09-08: yeosu-bokchun-restaurant had been searched 19 times and
 * seoul-dallas-pizza 41, both far past 7, and 110 of the 169 slugs in the
 * ledger were in that state — spending a Places budget of 100 searches a day
 * on posts whose photograph does not exist in any free-licensed source.
 *
 * Paused is not abandoned: Commons and Foursquare do gain photos, so an
 * exhausted slug still gets one night in thirty. The caller's SLUGS/ONLY
 * override bypasses this entirely.
 *
 * @param {number|undefined} attempts nights already spent on this slug
 * @returns {boolean} true when the slug should not be searched tonight
 */
export function isPausedTonight(attempts) {
  const n = Number(attempts) || 0;
  if (n < GIVE_UP_AFTER) return false;
  return (n - GIVE_UP_AFTER) % RECHECK_EVERY !== 0;
}
