// ─────────────────────────────────────────────────────────────
//  AUDIT VERDICT CLASSIFIER — did we JUDGE this photo, or merely fail to
//  FETCH it?
//
//  data/visual-audit.json is the vision gate's long memory, and every reader
//  gates on /MISMATCH/. That works only if a MISMATCH means "we looked at this
//  photo and it is wrong for this post". On 2026-08-30 it did not: 24 entries
//  said MISMATCH because a CDN answered 502 or because the width probe came
//  back unknown — statements about the network, not the picture. Twenty of the
//  twenty-four opened on the first try once imageFetch walked to the other UA.
//
//  A wrong verdict here is expensive in BOTH directions, so the rule is
//  narrow on purpose:
//    • drop  — the reason names a transient refusal (429/502/503/504) or a
//              width we could not measure. Nothing was judged; try again.
//    • keep  — everything else, including a MEASURED shortfall ("553px <
//              1200") and 404/410, which are real absences no retry undoes.
//              Dropping a real verdict lets a photo already proven wrong walk
//              back onto the page in silence.
// ─────────────────────────────────────────────────────────────

// Transient refusals only. 404/410 are deliberately absent: the file is gone.
const TRANSIENT_FETCH = /\b(?:image fetch|HTTP|status)\s*(?:429|502|503|504)\b|image unusable: (?:fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|timeout|aborted|socket hang up)/i;
// "width: unknownpx < 1200" (old) and "width: unknown (<1200)" (new).
const UNMEASURED_WIDTH = /width:\s*unknown/i;

/**
 * True when the stored entry records a failure to MEASURE, not a judgement.
 * @param {{verdict?: string, reason?: string} | unknown} entry
 */
export function isMeasurementFailure(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const reason = typeof entry.reason === 'string' ? entry.reason : '';
  if (!reason) return false;
  return UNMEASURED_WIDTH.test(reason) || TRANSIENT_FETCH.test(reason);
}
