/**
 * End a meta description on a complete sentence.
 *
 * A snippet that stops mid-word — "…prized for fresh Thai and Northern (Lanna)"
 * — reads as broken to anyone scanning a results page, and these are the hub
 * pages that should be winning "paris travel guide". Measured 2026-08-07: 663 of
 * 892 region/destination blurbs were being cut by a bare `.slice(0, 155)`, 99%
 * of the English ones and 100% of the Spanish.
 *
 * scripts/lib/serp.mjs has had a sentence-aware clip all along — the components
 * simply never used it. This is that logic plus a CJK branch, kept separate on
 * purpose: serp.mjs runs in the PUBLISH pipeline and its output is written into
 * frontmatter and then translated, so changing it rewrites stored descriptions
 * across the catalogue. This one runs at RENDER time and changes only what the
 * page prints. Fix a bug in one, port it to the other.
 */

import { lastSentenceEnd, nextSentenceEnd, closeDanglingBracket } from './sentence-boundary.mjs';

// Han, kana, hangul. Their glyphs are full-width, so a CJK snippet reaches the
// same pixel width in roughly half the characters, and Google truncates on
// pixels. Counting to 158 there produces a snippet that is cut off on screen
// no matter how cleanly it ends.
const CJK_CHAR = new RegExp(String.raw`[぀-ヿ㐀-鿿가-힯]`);
// CJK sentences end without a following space, so the Latin ". " test never
// fires; these are the terminators to look for instead. Korean is the reason
// the ASCII stop is in here too — it ends sentences with "." like English while
// being full-width everywhere else, so a 。-only pattern matched nothing at all
// on ko pages.
const CJK_SENTENCE_END = new RegExp(String.raw`[。！？.!?]`, 'g');

// Shortest snippet worth keeping, as a share of the budget. A complete sentence
// is the goal, but a three-word one tells a searcher nothing, so anything under
// this reaches forward to the next terminator instead. Proportional rather than
// the fixed 60 it started as: at the real budget of 158 that is ~52 and behaves
// the same, while a caller passing a small n no longer gets the fallback branch
// on every string. (The fixed 60 also rejected a legitimate 57-char first
// sentence — "Paris is a city of grand boulevards and quiet courtyards." — and
// ran on into the next one.)
const MIN_SHARE = 1 / 3;

const isCJK = (s) => CJK_CHAR.test(s);

/** Last index of a CJK sentence terminator at or before `limit`. */
function lastCjkStop(s, limit) {
  CJK_SENTENCE_END.lastIndex = 0;
  let best = -1;
  for (const m of s.slice(0, limit).matchAll(CJK_SENTENCE_END)) best = m.index;
  return best;
}

/**
 * @param {string} s   the full text
 * @param {number} n   character budget for Latin text; CJK uses half
 * @returns {string}   text ending on a sentence, never mid-word
 */
export function clip(s, n = 158) {
  if (!s) return s ?? '';
  const limit = isCJK(s) ? Math.min(n, 78) : n;
  if (s.length <= limit) return s;

  if (isCJK(s)) {
    const stop = lastCjkStop(s, limit);
    if (stop >= Math.floor(limit * MIN_SHARE)) return s.slice(0, stop + 1);
    const next = s.slice(limit).search(CJK_SENTENCE_END);
    if (next >= 0 && limit + next < limit * 2) return s.slice(0, limit + next + 1);
    // No terminator anywhere near: cut on a CJK character boundary and close
    // it. No word-boundary trim — CJK has no spaces to trim to.
    return s.slice(0, limit).replace(/[\s,、;:·—–-]+$/, '') + '…';
  }

  const cut = s.slice(0, limit);
  // Ported from scripts/lib/serp.mjs (2026-08-10): an abbreviation dot in an
  // address ("8 Pl. de l'Abbé Larue") is not a sentence end, and neither is a
  // boundary that would leave a bracket open.
  const floor = Math.floor(limit * MIN_SHARE);
  const lastPunct = lastSentenceEnd(cut, floor);
  if (lastPunct >= floor) return cut.slice(0, lastPunct + 1).trim();
  // No sentence boundary inside the limit — the writer's answer-first style
  // routinely opens with a 200-char sentence, so a slightly-long COMPLETE
  // sentence beats a 158-char stump: Google truncates display on its own, and
  // the validator's TRUNCATED-DESCRIPTION gate stays quiet.
  const sentEnd = nextSentenceEnd(s, limit);
  if (sentEnd >= 0 && sentEnd < 300) return s.slice(0, sentEnd + 1).trim();
  // First sentence longer than ~300 chars (rare): keep the word-trimmed
  // fragment but close it as a sentence so nothing dangles.
  const frag = cut.replace(/\s+\S*$/, '')
    .replace(/\s*\([^)]*$/, '')
    .replace(/(?:\s+(?:and|or|but|so|to|the|an?|with|for|at|on|in|from|by|of))+$/i, '')
    .replace(/[\s,;:.\-–—]+$/, '').trim();
  return closeDanglingBracket(frag + '.');
}
