// Where a sentence really ends — shared by both meta-description clippers.
//
// Both of them used to take the last ". " inside the character budget as a
// sentence end. An address does that too. lyon-jardin-des-curiosites opened
// "…in Lyon's Fourvière district (8 Pl. de l'Abbé Larue, 69005) with sweeping
// views…" and shipped as
//   "…in Lyon's Fourvière district (8 Pl. 4.7★ (2,109 reviews) — what visitors
//    say, hours, and tips."
// — clipped inside the street abbreviation, the bracket left hanging, and the
// rating badge welded onto the fragment (found 2026-08-10 by the validator's
// TRUNCATED-DESCRIPTION gate, which only caught it because the paren was
// unbalanced; an abbreviation with no bracket around it clips just as wrong
// and ends in a period, so it passes silently).
//
// This was known: backfill-descriptions.mjs has carried a note since the
// bandung-wheels case ("…Martadinata No.") saying re-clipping a healthy
// description breaks it. That was a workaround at ONE call site — generate.mjs
// kept producing the fault on every new post. This is the fix at the source.
//
// A candidate terminator is a real sentence end only when the token before it
// is not a known abbreviation or a bare initial, and the text it would leave
// behind closes every bracket it opened.

// Abbreviations that ALWAYS have something following them — a street name, a
// mountain, a number, a person. A dot here is never the end of a sentence.
// Bare initials ("J. M. Barrie", "R.E. Martadinata") behave the same way.
const ALWAYS_MEDIAL =
  /(?:^|[\s(\[«"'—–-])(?:[A-Za-z]|Pl|Pza|Plz|Ste|Sta|Sto|Ave|Blvd|Bd|Rte|Hwy|Apt|Bldg|Rm|Fl|Dr|Prof|Mr|Mrs|Ms|Sra|Mt|Mte|Nr|No|Nos|Núm|Jl|Jln|Soi|vs|approx|e\.g|i\.e|cf|ca)\.$/;

// `St.` is both "Saint" (always medial: "framed by St. Louis Cathedral") and
// "Street" (a legitimate sentence end: "201 E Randolph St."). The word before
// it tells them apart — a street name is capitalised, the preposition before a
// saint is not. Both shapes are live on the site, which is why this one gets a
// rule instead of a list entry.
const SAINT_MEDIAL = /(?:^|[\s(\[«"'—–-])(?:[a-z]+|by|of|near|on)\s+(?:St|Ste)\.$/;

/**
 * Does this text stop on an abbreviation that cannot end a sentence? A
 * finished meta description never does — "…on Jl. R.E. Martadinata No." is a
 * clip, not a sentence — so the validator can use this to catch the silent
 * half of the fault, the one with no unbalanced bracket to give it away.
 *
 * Deliberately silent on the endings that CAN close a sentence ("Rountree
 * Jr.", "Randolph St.") — a false alarm here sends a healthy post to an LLM
 * rewriter or a quarantine gate, which costs more than the miss.
 */
export const endsInAbbreviation = (s) => {
  const t = s.trim();
  return ALWAYS_MEDIAL.test(t) || SAINT_MEDIAL.test(t);
};

const ABBREV_BEFORE_DOT = (head) => ALWAYS_MEDIAL.test(head) || SAINT_MEDIAL.test(head);

export const bracketsBalanced = (s) =>
  (s.match(/[(（[［]/g) || []).length === (s.match(/[)）\]］]/g) || []).length;

/**
 * Is `text[i]` (a `.`/`!`/`?`) the end of a sentence rather than an
 * abbreviation dot or a clip that would strand an open bracket?
 */
export function isSentenceEnd(text, i) {
  const ch = text[i];
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;
  // A terminator run through to the end of the candidate is fine; otherwise
  // whitespace (or a closing quote then whitespace) has to follow.
  const rest = text.slice(i + 1);
  if (rest && !/^['"”’)\]]*(\s|$)/.test(rest)) return false;
  const head = text.slice(0, i + 1);
  if (ch === '.' && ABBREV_BEFORE_DOT(head)) return false;
  return bracketsBalanced(head);
}

/**
 * Index of the last real sentence end at or after `min` within `cut`,
 * or -1 when there is none.
 */
export function lastSentenceEnd(cut, min = 0) {
  for (let i = cut.length - 1; i >= min; i--) {
    if (isSentenceEnd(cut, i)) return i;
  }
  return -1;
}

/**
 * Index of the first real sentence end at or after `from` in `text`,
 * or -1 when there is none.
 */
export function nextSentenceEnd(text, from) {
  for (let i = from; i < text.length; i++) {
    if (isSentenceEnd(text, i)) return i;
  }
  return -1;
}

/**
 * Last resort for a fragment that still holds an unclosed bracket: drop the
 * opening bracket and everything after it, then close the fragment cleanly.
 */
export function closeDanglingBracket(s) {
  if (bracketsBalanced(s)) return s;
  const trimmed = s
    .replace(/\s*[(（[［][^)）\]］]*$/, '')
    .replace(/[\s,;:.\-–—]+$/, '')
    .trim();
  if (!trimmed) return s;
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
