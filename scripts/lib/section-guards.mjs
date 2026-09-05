// ─────────────────────────────────────────────────────────────
//  GUARDS FOR ONE GENERATED ESSENTIALS SECTION
//
//  Two things went wrong in the first Japan run (2026-09-05, commit f48b2afd)
//  that the generator itself could not see:
//    1. The model's internal monologue ("I have enough verified information
//       now to write the section...") leaked into the published file. The
//       existing strip regex only matched a fixed set of sentence-starters
//       anchored to the top of the text, so it missed this phrasing entirely.
//    2. A price range ("¥300–400 for small lockers...") was published even
//       though none of the three cited sources states it — two were Narita
//       AIRPORT pages (which state different, airport-only figures) and one
//       was a third-party App Store listing.
//
//  Both functions here are exported so they can be unit-tested without
//  burning an API call or a live fetch — see section-guards.test.mjs.
// ─────────────────────────────────────────────────────────────

// Phrases seen leaking into published sections, plus the ones the review
// asked to guard against pre-emptively. Checked over the WHOLE text, not
// just the first line, because the leak can land mid-paragraph after a
// tool-call boundary.
const META_PATTERNS = [
  /\bi have enough\b/i,
  /\bi now have\b/i,
  /\blet me\b/i,
  /\bi'll\b/i,
  /\bi will\b/i,
  /\bbased on my search\b/i,
  /\bsearching\b/i,
  /\bnow i\b/i,
  /\bhere is the section\b/i,
  /\bi found\b/i,
];

/**
 * Returns the matched phrase if `text` contains a first-person meta sentence
 * (the model talking about its own research process instead of just writing
 * the section), or null if the text is clean.
 */
export function metaTextIn(text) {
  for (const re of META_PATTERNS) {
    const m = re.exec(String(text));
    if (m) return m[0];
  }
  return null;
}

// Drop URLs before hunting for numbers so a port number, a locker-page id, or
// a year embedded in a URL slug is never mistaken for a stated price.
function withoutLinkUrls(md) {
  return String(md).replace(/\]\((https?:\/\/[^)\s]+)\)/g, ']()');
}

function isYear(token) {
  return /^\d{4}$/.test(token) && Number(token) >= 1900 && Number(token) <= 2099;
}

/** Distinct numerals in `text`, thousands-comma normalized, years and URL digits excluded. */
export function numbersIn(text) {
  const stripped = withoutLinkUrls(text);
  const matches = stripped.match(/\d[\d,]*\d|\d/g) || [];
  const out = new Set();
  for (const raw of matches) {
    const n = raw.replace(/,/g, '');
    if (!n || isYear(n)) continue;
    out.add(n);
  }
  return [...out];
}

/** Plain, digit-searchable version of a source page: tags and entities stripped,
 *  thousands-separator commas between digits collapsed so "1,200" reads as "1200". */
function toSearchable(sourceText) {
  return String(sourceText)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
}

/**
 * Every distinct numeral in `text` must appear in at least one of `sourceTexts`
 * (already-fetched page bodies, HTML or plain). Returns the list of numerals
 * that appear in none of them — an empty array means every number is supported.
 */
export function unsupportedNumbers(text, sourceTexts) {
  const numbers = numbersIn(text);
  if (!numbers.length) return [];
  const searchables = (sourceTexts || []).map(toSearchable);
  return numbers.filter((n) => !searchables.some((s) => s.includes(n)));
}
