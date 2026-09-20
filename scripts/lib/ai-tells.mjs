// The phrases that make a guide read as machine-written.
//
// These lived inside scripts/audit-ai-tells.mjs, which is a CLI that runs on
// import, so nothing else could use them. They move here because the writer
// needs the same list the audit uses: on 2026-09-08 the phrases were added to
// the writer prompt as a ban, and by 2026-09-19 nine guides published after
// that date carried one anyway — five of them "whether you're X or Y". A rule
// the model is asked to follow is not a gate; the gate is checking the draft
// and asking once for a rewrite (the same shape as the event-timeless retry).
//
// Each entry was counted in the corpus before it was added. A phrase nobody
// writes is not worth a rule, and a phrase people legitimately write is worth
// leaving alone.
export const TELLS = {
  'in the heart of': /\bin the heart of\b/gi,
  "isn't just…it's": /\b(?:isn't|is not) just\b[^.]{0,60}\bit(?:'s| is)\b/gi,
  // The HYPE use ("a must-visit temple", "the food is a must try"), not the
  // ordinary modal: "you must visit the office before 5pm to collect the
  // permit" is plain English and was being flagged, which would have sent the
  // writer into a pointless rewrite the day the gate below went in (2026-09-19).
  'must-visit/see': /(?<!\b(?:you|we|i|they|he|she|one|visitors?|travell?ers?|guests?)\s)\bmust[- ](?:visit|see|try|do)\b/gi,
  'whether you…or': /\bwhether you(?:'re| are)?\b[^.]{0,80}\bor\b/gi,
  iconic: /\biconic\b/gi,
  'hidden gem': /\bhidden gems?\b/gi,
  'not just…but': /\bnot just\b[^.]{0,60}\bbut\b/gi,
  bustling: /\bbustling\b/gi,
  nestled: /\bnestled\b/gi,
  unwind: /\bunwind\b/gi,
  vibrant: /\bvibrant\b/gi,
  tapestry: /\btapestry\b/gi,
  'testament to': /\btestament to\b/gi,
  delve: /\bdelve\b/gi,
  'a myriad of': /\ba myriad of\b/gi,
  plethora: /\bplethora\b/gi,
  breathtaking: /\bbreathtaking\b/gi,
  'immerse yourself': /\bimmerse yourself\b/gi,
  'when it comes to': /\bwhen it comes to\b/gi,
  'in conclusion': /\bin conclusion\b/gi,
  "it's worth noting": /\bit(?:'s| is) worth noting\b/gi,
  'rich history/culture': /\brich (?:history|culture|heritage)\b/gi,
  'foodie paradise': /\b(?:foodie|shopper's|traveller?'s) (?:paradise|haven|dream)\b/gi,
};

/** Count the tells in one article body. */
export function countTells(body) {
  const found = {};
  for (const [name, re] of Object.entries(TELLS)) {
    const n = (String(body ?? '').match(re) || []).length;
    if (n) found[name] = n;
  }
  return found;
}

/**
 * The first tell in a draft, as the EXACT text that matched — the retry has to
 * name what to remove, not a rule number. null when the draft is clean, which
 * the prompt makes the normal case.
 */
export function firstTell(body) {
  const s = String(body ?? '');
  let best = null;
  for (const re of Object.values(TELLS)) {
    const m = s.match(new RegExp(re.source, 'i'));
    if (m && (best === null || m.index < best.index)) best = { text: m[0], index: m.index };
  }
  return best ? best.text : null;
}

/**
 * Every tell in an article, as work the prose repair can act on.
 *
 * writer.mjs stops these at birth — a draft carrying one is re-requested — but
 * 208 of them were already published across 199 guides when that gate was
 * built, and nothing ever read the weekly count. A number nobody acts on is
 * not a check. These become rows in the same queue repair-prose already drains
 * at sixty a week, which ends the backlog in about a month and costs the audit
 * nothing: no model call is involved in finding them.
 *
 * `quote` is the EXACT matched text, because repair-prose only acts on a span
 * it can still find verbatim in the body. The sentence around it is the
 * repair's business, not this function's.
 *
 * @param {string} body
 * @returns {{type: 'ai-tell', quote: string, tell: string}[]}
 */
export function tellSpans(body) {
  const s = String(body ?? '');
  const out = [];
  const seen = new Set();
  const SEP = String.fromCharCode(0);
  for (const [name, re] of Object.entries(TELLS)) {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    for (const m of s.matchAll(new RegExp(re.source, flags))) {
      const quote = m[0];
      const key = `${name}${SEP}${quote.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'ai-tell', quote, tell: name });
    }
  }
  return out;
}
