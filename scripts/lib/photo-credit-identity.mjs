// ─────────────────────────────────────────────────────────────
//  PHOTO CREDIT IDENTITY — does the photo's credit name THIS place?
//
//  A Foursquare photo carries the business it was uploaded for, in brackets at
//  the end of the credit line. That bracket is the only thing that knows whether
//  the picture is of the venue in the article: the vision gate cannot tell, since
//  a real photo of a real café IS a plausible café, and it approves a picture of
//  California Pizza Kitchen on a Dallas Pizza post every time.
//
//  Extracted from validate-content.mjs on 2026-08-11 so the check can run BEFORE
//  a post is published, not only after. Releasing 34 quarantined posts that day
//  put five wrong-venue photos live — Ajman Secret Beach wearing Al Zaurah
//  Beach, XLIII Coffee wearing Thanh Tâm Coffee — each one approved by vision
//  and caught minutes later by the validator. A guard that only runs afterwards
//  is a report, not a gate.
// ─────────────────────────────────────────────────────────────

// Words too common to prove identity: two cafés both called "coffee" are not
// the same café. Kept in sync with validate-content.mjs by being the same list.
export const GENERIC = new Set([
  'the', 'cafe', 'café', 'coffee', 'restaurant', 'bar', 'bistro', 'pizza', 'house',
  'shop', 'store', 'hotel', 'market', 'street', 'food', 'temple', 'museum', 'park',
  'garden', 'palace', 'tower', 'beach', 'thai', 'korean', 'japanese', 'chinese',
  'italian', 'indian', 'grill', 'kitchen', 'bakery', 'lounge', 'club', 'center',
  'centre', 'and', 'for', 'with',
]);

export const flat = (v) =>
  String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9가-힣]/g, '');

export const words = (v) =>
  (String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9가-힣]{3,}/g) || [])
    .filter((w) => !GENERIC.has(w));

/**
 * The credited business name, when the credit line carries one.
 * Foursquare credits end with the venue in brackets: "Photo: … (Sugar Bistro)".
 */
export const creditedVenue = (credit) => (String(credit || '').match(/\(([^)]+)\)/) || [])[1] || null;

/**
 * The name of a DIFFERENT business the photo belongs to, or null when the photo
 * is (or may be) of this place. Returns null for non-Foursquare credits: only
 * Foursquare names its venue this way, and reading brackets from a Wikimedia
 * licence line ("(CC BY-SA 4.0)") would reject every Commons photo we have.
 */
export function wrongVenueCredit(placeName, credit) {
  if (!placeName || !/foursquare/i.test(String(credit || ''))) return null;
  const credited = creditedVenue(credit);
  if (!credited) return null;
  const a = flat(placeName), b = flat(credited);
  if (a.includes(b) || b.includes(a)) return null;            // same name, different spelling
  const mine = words(placeName), theirs = new Set(words(credited));
  if (mine.length && mine.some((w) => theirs.has(w))) return null;  // shares a proper noun
  return credited;
}
