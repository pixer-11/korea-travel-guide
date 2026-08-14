// Which posts the nightly photo patrol (backfill-photos-alt.mjs) looks at.
//
// Extracted so it can be tested. The predicate lived inline for months, and in
// that form it silently lost a whole class twice — a post can be published,
// showing no photograph at all, and match none of the patrol's conditions, so
// nothing ever tries to fill it again. It happened to 51 released events on
// 2026-08-10, and again on 2026-08-14 to venue guides whose wrong-place heroes
// the identity strip had removed: six of the eleven were unreachable, and the
// only reason the other five were not is an unrelated stale MISMATCH verdict
// still sitting in the store under their slug.
//
// The rule that closes it for good: A LIVE POST WITH NO HERO IS ALWAYS A
// TARGET. Not "a live event with no hero" — any of them. The vision bill
// self-limits, because filling one removes it from the set.
//
// This decides only whether the photo hunt keeps running. Whether a venue
// guide should be PUBLISHED without a photo is a per-post judgement call for
// the owner (2026-08-07), and nothing here publishes or unpublishes anything.

/** A published post showing no photograph — always worth another search. */
export function isPhotolessLive({ draft, heroUrl }) {
  return draft !== true && !heroUrl;
}

/**
 * @param {object} p
 * @param {boolean} p.draft        frontmatter draft flag
 * @param {string}  p.heroUrl      current hero URL ('' when there is none)
 * @param {boolean} p.flaggedNow   a MISMATCH/WEAK verdict against the hero it still shows
 * @param {boolean} p.auditAll     AUDIT_ALL=1
 * @param {boolean} p.named        named explicitly via SLUGS
 */
export function isPatrolTarget({ draft, heroUrl = '', flaggedNow = false, auditAll = false, named = false }) {
  return (
    auditAll ||
    named ||
    draft === true ||
    flaggedNow ||
    isPhotolessLive({ draft, heroUrl }) ||
    heroUrl.includes('placeholder')
  );
}
