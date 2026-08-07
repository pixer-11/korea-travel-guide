/**
 * How wide a string actually renders, in half-width units.
 *
 * BaseLayout appended "· Wander Atlas" whenever `title.length <= 60`. That is a
 * Latin ruler applied to every language: a CJK glyph occupies roughly twice the
 * horizontal space of a lowercase Latin letter, so 60 CJK characters is about
 * 120 units on screen against a search-result limit near 60. Measured over the
 * built output on 2026-08-07: 89% of Japanese titles, 95% of Korean and 68% of
 * Chinese exceeded the real ceiling, which means Google was near-certainly
 * rewriting them — and a rewritten title is one we no longer control.
 *
 * Half-width units, not pixels: a pixel measurement needs the font, and the
 * ratio that matters here (CJK ≈ 2× Latin) holds across the faces this site
 * ships. Counting in units keeps one number — 60 — meaning the same thing in
 * every language.
 */

// East Asian Wide and Fullwidth, the ranges this site can actually produce:
// hangul jamo, CJK radicals through the unified ideographs, compatibility
// ideographs, CJK punctuation and fullwidth forms, hangul syllables, and the
// kana. Everything outside these is counted as one unit, which is right for
// Latin, Cyrillic and Arabic alike.
const WIDE = [
  [0x1100, 0x115f], // hangul jamo
  [0x2e80, 0x303e], // CJK radicals, kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // hiragana, katakana, bopomofo, hangul compat jamo, CJK compat
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // yi
  [0xac00, 0xd7a3], // hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x20000, 0x3fffd], // CJK extensions B and beyond
];

const isWide = (cp) => WIDE.some(([lo, hi]) => cp >= lo && cp <= hi);

/**
 * @param {string} s
 * @returns {number} width in half-width units — a Latin character is 1, a CJK character is 2
 */
export function displayWidth(s) {
  if (!s) return 0;
  let w = 0;
  // for…of iterates by code point, so an astral character counts once, not twice.
  for (const ch of String(s)) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

/** True when the string still fits inside `units` half-widths. */
export const fitsWidth = (s, units) => displayWidth(s) <= units;
