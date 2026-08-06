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
  //
  // Both floors read as "if Google gave us a number, check it", so a venue with
  // NO rating and NO review count sailed through untested — which is the normal
  // state for a small-town park, viewpoint, historic site or market, i.e. four
  // of the twelve topic templates. The floors were switched off exactly where
  // the data is thinnest (found 2026-08-06). Missing now fails: there is no
  // basis to recommend a place Google has no signal on.
  if (typeof place.rating !== 'number') {
    reasons.push('no rating from Google — nothing to vouch for it');
  } else if (place.rating < MIN_RATING) {
    reasons.push(`rating ${place.rating} < ${MIN_RATING}`);
  }

  // 3. Enough reviews to trust the rating.
  if (typeof place.userRatingsTotal !== 'number') {
    reasons.push('no review count from Google — nothing to vouch for it');
  } else if (place.userRatingsTotal < MIN_REVIEWS) {
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
  'wikimedia', // Wikimedia Commons (CC BY / BY-SA / public domain), attributed
  'kto-open', // Korea Tourism Org public/open data
  'placeholder', // our own generated placeholder
  'foursquare', // Foursquare Places photos, used under API terms with attribution
  'flickr-cc', // Flickr — Creative Commons / no-known-restrictions ONLY (filtered at query)
]);

export function isImageAllowed(image) {
  return !!image && ALLOWED_IMAGE_LICENSES.has(image.license);
}
