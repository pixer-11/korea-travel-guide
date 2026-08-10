import { lastSentenceEnd, nextSentenceEnd, closeDanglingBracket } from '../../src/lib/sentence-boundary.mjs';

// Single source of truth for SERP-snippet copy rules: the meta-description
// sentence clip and the honest review-intent signal. Imported by BOTH
// generate.mjs (new posts) and the backfill scripts so the rules can never
// drift between them — they DID once: backfill-descriptions.mjs kept the old
// word-trim clip() after generate.mjs got the sentence-completing version, so
// a backfill run would have re-shipped the very "…and best experienced"
// fragments the 2026-08-01 repair removed.

// End meta descriptions on a FULL SENTENCE within the limit (no dangling ", …"
// that reads as auto-generated and depresses SERP CTR). Fall back to a word
// boundary only when no sentence fits, and close it as a sentence.
export const clip = (s, n = 158) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  // Abbreviation dots ("8 Pl. de l'Abbé Larue") are not sentence ends, and a
  // boundary that strands an open bracket is not one either — see
  // src/lib/sentence-boundary.mjs for the post that taught us that.
  const lastPunct = lastSentenceEnd(cut, 60);
  if (lastPunct >= 60) return cut.slice(0, lastPunct + 1).trim();
  // No sentence boundary inside the limit — the writer's answer-first style
  // routinely opens with a 200-char sentence, so a slightly-long COMPLETE
  // sentence beats a 158-char stump: Google truncates display on its own, and
  // the validator's TRUNCATED-DESCRIPTION gate stays quiet.
  const sentEnd = nextSentenceEnd(s, n);
  if (sentEnd >= 0 && sentEnd < 300) return s.slice(0, sentEnd + 1).trim();
  // First sentence longer than ~300 chars (rare): keep the word-trimmed
  // fragment but close it as a sentence so nothing dangles.
  const frag = cut.replace(/\s+\S*$/, '')
    .replace(/\s*\([^)]*$/, '')
    .replace(/(?:\s+(?:and|or|but|so|to|the|an?|with|for|at|on|in|from|by|of))+$/i, '')
    .replace(/[\s,;:.\-–—]+$/, '').trim();
  return closeDanglingBracket(frag + '.');
};

// A rating strong enough to advertise in the snippet. Numbers come ONLY from
// the stored Google place data (place.rating / place.userRatingsTotal) —
// never invented, never rounded up. Below the bar we simply stay silent;
// omission is honest, a made-up or flattering number is not.
export function strongRating(place) {
  const rating = Number(place?.rating);
  const total = Number(place?.userRatingsTotal);
  if (!(rating >= 4.0) || !(total >= 100)) return null;
  return { rating, total };
}

// "4.9★ (39,410 reviews)" — the review-intent phrase for SERP copy.
// GSC 2026-08-03: venue pages ranked 4-10 on "<venue> reviews" queries with
// 0% CTR because neither title nor description ever said "reviews".
export function ratingBadge(place) {
  const sr = strongRating(place);
  if (!sr) return '';
  return `${sr.rating.toFixed(1)}★ (${sr.total.toLocaleString('en-US')} reviews)`;
}

// Append the badge as its own closing sentence — unless the description
// already talks ratings/reviews (writer-woven copy like abu-dhabi-flavors-
// grill's "well-rated (4.9-star, 39,000+ reviews)" stays untouched, and a
// re-run never double-appends). Ends in terminal punctuation for the
// TRUNCATED-DESCRIPTION gate.
export function withRatingSignal(desc, place) {
  const badge = ratingBadge(place);
  if (!badge) return desc;
  if (/\breviews?\b|\bratings?\b|\brated\b|★/i.test(desc)) return desc;
  // Never weld the badge onto a fragment with an open bracket — that is how
  // "…district (8 Pl. 4.7★ (2,109 reviews) — …" reached production. The clip
  // above no longer produces one, but a description can also arrive from an
  // older post, and the badge must not make an existing fault unreadable.
  return `${closeDanglingBracket(desc)} ${badge} — what visitors say, hours, and tips.`;
}
