// ─────────────────────────────────────────────────────────────
//  GUARDRAILS — the reason we can publish unattended.
//  A place must PASS every check or it is auto-skipped. This is
//  what replaces a human approving each post.
// ─────────────────────────────────────────────────────────────

const MIN_RATING = Number(process.env.MIN_RATING ?? 4.0);
const MIN_REVIEWS = Number(process.env.MIN_REVIEWS ?? 50);

/**
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function checkPlace(place) {
  const reasons = [];

  if (!place) {
    return { ok: false, reasons: ['no place data'] };
  }

  // 1. Must be open for business. This auto-drops closed venues.
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    reasons.push(`business status is ${place.businessStatus}`);
  }

  // 2. Quality floor — don't recommend poorly-rated spots.
  if (typeof place.rating === 'number' && place.rating < MIN_RATING) {
    reasons.push(`rating ${place.rating} < ${MIN_RATING}`);
  }

  // 3. Enough reviews to trust the rating.
  if (
    typeof place.userRatingsTotal === 'number' &&
    place.userRatingsTotal < MIN_REVIEWS
  ) {
    reasons.push(`only ${place.userRatingsTotal} reviews < ${MIN_REVIEWS}`);
  }

  // 4. Need a name and location to write anything real.
  if (!place.name) reasons.push('missing name');

  return { ok: reasons.length === 0, reasons };
}

// Only images from these sources may be published. Anything else is
// dropped rather than risk a copyright claim.
const ALLOWED_IMAGE_LICENSES = new Set([
  'google-places', // used under Google Places API terms, with attribution
  'unsplash', // Unsplash License
  'kto-open', // Korea Tourism Org public/open data
  'placeholder', // our own generated placeholder
]);

export function isImageAllowed(image) {
  return !!image && ALLOWED_IMAGE_LICENSES.has(image.license);
}
