// Keep a rating written into PROSE true.
//
// The weekly refresh updates place.rating from Google. resync-rating-badges
// then rewrites the "4.7★ (706 reviews)" badge in the meta description — but
// nothing ever touched the same number baked into a sentence, so a post could
// read "verified visitor ratings put it at 4.8 stars" directly above a fact box
// saying 4.7 (found 2026-08-17 on ayutthaya-ayutthaya-historical-park).
//
// The writer prompt now tells the generator to characterise and leave the
// figure to the box, and it works — 86% of the posts written on Jul 21 bake a
// number, against 0-8% of this week's. But 293 live posts were written before
// that, and every one is a number Google can move underneath us.
//
// OWNERSHIP: this module is the BODY only. The description badge belongs to
// rating-badge-sync.mjs. Two tools, two surfaces, no overlap.
//
// ── how a decimal is known to be a rating ──
//
// The number is identical in every language — only the words around it are
// translated:
//   en  4.8 stars              ko  4.8점의 평점 / 평점 4.8을
//   ja  評価4.8を獲得           zh  评分高达4.8星          es  4.8 estrellas / 4,8 sobre 5
// So the digits are the anchor and a CUE WORD nearby is the proof. A bare
// decimal is never touched: "4.8 km from the station" has no cue and survives,
// and a unit immediately after the number vetoes the match outright even when a
// cue happens to be in the sentence.
//
// ── the boundary that matters most: EXACT vs HEDGED ──
//
// Málaga's botanical garden says "a rating that consistently sits above 4.5"
// while Google now says 4.6. The sentence is TRUE — 4.6 is above 4.5 — and
// mechanically resyncing it to "above 4.6" would MAKE IT FALSE. A hedge is a
// claim about a range, so it cannot be resynced by swapping its digit at all.
// Only exact claims are rewritten. Hedges are checked against their own logic
// instead (an "above 4.5" is reported only once the rating actually falls
// below 4.5) and are never edited. A repair tool that turns a true sentence
// into a false one is worse than the drift it was written to fix.

// Rating vocabulary in the five languages the site ships. Drawn from a scan of
// all 1,124 translations of the posts that carry a prose rating — not guessed.
const CUES = [
  // en
  'rating', 'rated', 'star', 'stars', 'score', 'scores', 'scored', 'review', 'reviews', 'average',
  // ko
  '평점', '별점', '점의', '점을', '점이', '리뷰', '평가',
  // ja
  '評価', 'レビュー', '星', '点',
  // zh
  '评分', '评价', '好评', '星级', '条评',
  // es
  'calificación', 'calificaciones', 'puntuación', 'valoración', 'estrella', 'estrellas',
  'reseña', 'reseñas', 'sobre', 'media',
];
const CUE_RE = new RegExp(CUES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

// A rating suffix welded to the digits is proof on its own — "4.7分", "4.4星",
// "4.8점", "4.6★". It outranks the unit veto below, because 分 and 点 are the
// Chinese word for *points* in exactly this position while also being the word
// for minutes elsewhere. A duration cannot plausibly be a 1-5 one-decimal
// number that equals this venue's stored rating with a review cue beside it.
const RATING_SUFFIX = /^\s?(?:★|星|점|分|点|스타|\/\s*5\b)/;

// Otherwise a unit right after the number means it measures something else.
// This vetoes even when a cue sits elsewhere in the window, because "a 4.8 km
// walk from the 4.6-star hotel" is the sentence that would otherwise corrupt.
const UNIT_RE = /^\s*(?:km|kms|m|mi|miles?|kg|%|℃|°|\$|€|£|₫|¥|원|USD|EUR|VND|THB|시간|분|時間|公里|米|元|块|ha|acres?|hours?|hrs?|days?|min|minutes?|billion|million|만|억)\b/i;

// CJK packs a clause into a few characters; Spanish spends forty on the same
// thought ("ha logrado una calificación inusualmente alta de 4.8"). One window
// has to hold both, so it is sized to the longest real example in the corpus.
const LEFT = 46;
const RIGHT = 26;

// Hedges, by the direction they claim. Matched against the text immediately
// before the number (and, for the languages that postpose them, immediately
// after). "above 4.5" survives a rise and breaks on a fall; "around 4.3" is
// only wrong once the figure wanders well away from it.
const HEDGE_BEFORE = [
  [/(?:above|over|north of|upwards of|at least|more than|exceed(?:s|ing)?|higher than)\W{0,4}$/i, 'above'],
  [/(?:below|under|less than|beneath|lower than)\W{0,4}$/i, 'below'],
  [/(?:around|about|near(?:ly)?|almost|roughly|approximately|circa|hovering|close to)\W{0,4}$/i, 'approx'],
  [/(?:이상|넘는|넘게|초과)\W{0,3}$/, 'above'],
  [/(?:미만|이하)\W{0,3}$/, 'below'],
  [/(?:약|대략|거의)\W{0,3}$/, 'approx'],
  [/(?:以上|を超え|超える|超过|高于)\W{0,3}$/, 'above'],
  [/(?:以下|未満|低于)\W{0,3}$/, 'below'],
  [/(?:約|およそ|ほぼ|大约|大約|将近|接近)\W{0,3}$/, 'approx'],
  [/(?:por encima de|más de|superior a|supera(?:ndo)?)\W{0,4}$/i, 'above'],
  [/(?:por debajo de|menos de|inferior a)\W{0,4}$/i, 'below'],
  [/(?:alrededor de|cerca de|casi|en torno a|aproximadamente|unos|unas)\W{0,4}$/i, 'approx'],
];
const HEDGE_AFTER = [
  [/^\s?(?:점?\s?이상|以上|超|左右|前後)/, 'above'],
  [/^\s?(?:점?\s?미만|以下|未満)/, 'below'],
];

function hedgeAt(text, index, len) {
  const before = text.slice(Math.max(0, index - LEFT), index);
  for (const [re, kind] of HEDGE_BEFORE) if (re.test(before)) return kind;
  const after = text.slice(index + len, index + len + 8);
  for (const [re, kind] of HEDGE_AFTER) if (re.test(after)) return kind === 'above' && /左右|前後/.test(after) ? 'approx' : kind;
  return null;
}

/**
 * Every decimal in `text` that equals `value` AND reads as a rating.
 * Each hit carries `hedge`: null for an exact claim, else 'above'|'below'|'approx'.
 */
export function findRatings(text, value) {
  const s = String(text ?? '');
  const [whole, frac] = Number(value).toFixed(1).split('.');
  // Not part of a longer number: "14.8" is skipped by the digit lookbehind and
  // "4.85" by the digit lookahead. The separator lookbehind is deliberately
  // narrow — it rejects the tail of a grouped number ("2,109.8") but NOT an
  // ordinary comma, because Chinese writes "(538条评论,4.4星)" and an
  // unconditional [.,] veto silently skipped every rating written that way.
  const re = new RegExp(String.raw`(?<!\d)(?<!\d[.,])${whole}[.,]${frac}(?![\d])`, 'g');
  const out = [];
  for (const m of s.matchAll(re)) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + RIGHT);
    if (!RATING_SUFFIX.test(after) && UNIT_RE.test(after)) continue;
    const before = s.slice(Math.max(0, m.index - LEFT), m.index);
    if (!CUE_RE.test(before) && !CUE_RE.test(after)) continue;
    out.push({ index: m.index, raw: m[0], hedge: hedgeAt(s, m.index, m[0].length) });
  }
  return out;
}

/** Exact-claim hits only — the ones this module is willing to rewrite. */
const exactOnly = (hits) => hits.filter((h) => !h.hedge);

/**
 * Rewrite every EXACT prose rating equal to `stale` so it reads `live`, keeping
 * each occurrence's own decimal separator (Spanish writes 4,8). Hedged claims
 * are left exactly as written. Pure.
 * Returns { text, count }; count 0 means nothing to write.
 */
export function syncProseRating(text, stale, live) {
  const s = String(text ?? '');
  const hits = exactOnly(findRatings(s, stale));
  if (!hits.length) return { text: s, count: 0 };

  const target = Number(live).toFixed(1);
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    const sep = h.raw.includes(',') ? ',' : '.';
    out += s.slice(cursor, h.index) + target.replace('.', sep);
    cursor = h.index + h.raw.length;
  }
  return { text: out + s.slice(cursor), count: hits.length };
}

/**
 * What a body claims about its rating that the live figure contradicts.
 * Returns [{ value, hedge, reason }]. Exact claims are wrong the moment they
 * differ; a hedge is wrong only when its own direction breaks.
 */
export function ratingClaimProblems(body, live) {
  const s = String(body ?? '');
  const out = [];
  for (let tenth = 10; tenth <= 50; tenth++) {
    const value = tenth / 10;
    for (const h of findRatings(s, value)) {
      if (!h.hedge) {
        if (Math.abs(value - live) >= 0.05) out.push({ value, hedge: null, reason: `prose states ${value}, live data says ${live}` });
      } else if (h.hedge === 'above' && live < value) {
        out.push({ value, hedge: 'above', reason: `prose says the rating is above ${value}, live data says ${live}` });
      } else if (h.hedge === 'below' && live > value) {
        out.push({ value, hedge: 'below', reason: `prose says the rating is below ${value}, live data says ${live}` });
      } else if (h.hedge === 'approx' && Math.abs(value - live) >= 0.3) {
        out.push({ value, hedge: 'approx', reason: `prose says the rating is around ${value}, live data says ${live}` });
      }
    }
  }
  return out;
}

/**
 * True when two texts differ ONLY in rating figures — the safety catch for
 * re-stamping a translation's srcHash. Mirrors differsOnlyInBadge: it lets the
 * sync say "this translation is still current" when the only change was a
 * number it copied across, and refuses when the prose itself moved.
 */
export function differsOnlyInRating(before, after, stale, live) {
  if (before === after) return false;
  const blank = (s, v) => {
    const hits = exactOnly(findRatings(s, v));
    let out = '', cursor = 0;
    for (const h of hits) { out += s.slice(cursor, h.index) + '[[R]]'; cursor = h.index + h.raw.length; }
    return out + s.slice(cursor);
  };
  return blank(before, stale) === blank(after, live);
}
