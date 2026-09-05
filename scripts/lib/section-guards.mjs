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

// ─────────────────────────────────────────────────────────────
//  CURRENCY-AWARE STRICT CHECK (round 2, 2026-09-05 review)
//
//  The plain substring check above is too loose for money: a postal code, a
//  bus route number, a visitor count or a year will routinely contain the
//  same digits as a fabricated price, anywhere on an unrelated page. A price
//  is exactly the kind of number this guard exists to verify, so a figure
//  that carries a currency marker in the draft gets a stricter rule: the
//  same digits must appear near an actual currency marker in the source,
//  not merely anywhere on the page.
// ─────────────────────────────────────────────────────────────

// Multi-character symbols first so "HK$100" / "S$12" are recognized as a
// single currency token, though matching just the bare "$" would already be
// enough to flag the position as currency-adjacent.
const CURRENCY_PREFIXED_SYMBOLS = ['HK\\$', 'NT\\$', 'S\\$'];
const CURRENCY_BARE_SYMBOLS = ['¥', '\\$', '€', '£', '₩', '฿'];

// Letter markers (codes and words) use lookaround instead of \b: a code is
// routinely glued directly to its digits with no space ("1000JPY",
// "12THB"), and \w includes digits, so a digit-letter join is never a \b
// boundary. The lookaround only rejects a LETTER on either side, so "1000JPY"
// still matches while "arm"/"form"/"wonder" do not falsely match RM/won.
const CURRENCY_LETTER_MARKERS = [
  'RM', 'AED', 'USD', 'JPY', 'EUR', 'THB', 'KRW',
  'yen', 'won', 'baht', 'euros?', 'dollars?', 'rupees?', 'dirhams?', 'pesos?',
  'yuan', 'ringgit', 'rupiah', 'dong', 'som', 'riel', 'lira',
];

const CURRENCY_MARKER = '(?:' + [
  ...CURRENCY_PREFIXED_SYMBOLS,
  ...CURRENCY_LETTER_MARKERS.map((w) => `(?<![A-Za-z])${w}(?![A-Za-z])`),
  ...CURRENCY_BARE_SYMBOLS,
].join('|') + ')';

const NUM_TOKEN = '\\d[\\d,]*';
// Hyphen, en dash, em dash, ASCII tilde and full-width tilde all show up in
// fetched source pages as a range separator ("¥800–1,000", "800～1000JPY").
const RANGE_SEP = '[-–—~～]\\s*';

function normalizeDigitToken(raw) {
  return String(raw).replace(/[,\s]/g, '');
}

/**
 * Figures in `text` that carry a currency marker immediately before them
 * (`¥400`, `RM 12`) or immediately after (`400 yen`, `12 THB`). A range
 * (`¥800–1,000`) yields both ends. Digits are comma/space-normalized.
 */
export function currencyNumbersIn(text) {
  const s = withoutLinkUrls(String(text));
  const out = new Set();
  const beforeRe = new RegExp(`${CURRENCY_MARKER}\\s*(${NUM_TOKEN})(?:\\s*${RANGE_SEP}(${NUM_TOKEN}))?`, 'gi');
  const afterRe = new RegExp(`(${NUM_TOKEN})(?:\\s*${RANGE_SEP}(${NUM_TOKEN}))?\\s*${CURRENCY_MARKER}`, 'gi');
  for (const re of [beforeRe, afterRe]) {
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) out.add(normalizeDigitToken(m[1]));
      if (m[2]) out.add(normalizeDigitToken(m[2]));
    }
  }
  return [...out];
}

/** True if `num` (already comma-normalized digits) appears within 30 characters
 *  of a currency marker somewhere in `searchableSource` — not merely on the page. */
function isCurrencySupportedIn(num, searchableSource) {
  const markerRe = new RegExp(CURRENCY_MARKER, 'gi');
  let m;
  while ((m = markerRe.exec(searchableSource))) {
    const start = Math.max(0, m.index - 30);
    const end = Math.min(searchableSource.length, m.index + m[0].length + 30);
    if (searchableSource.slice(start, end).includes(num)) return true;
  }
  return false;
}

/**
 * Every distinct numeral in `text` must be supported by at least one of
 * `sourceTexts` (already-fetched page bodies, HTML or plain). A numeral that
 * carries a currency marker in `text` (a price) is held to the strict rule —
 * the same digits within 30 characters of a marker in a source, not merely
 * anywhere on the page. Every other numeral keeps the original loose
 * substring rule, so "24 hours" or "three days" isn't newly refused.
 * Returns the list of numerals that fail — an empty array means every
 * number is supported.
 */
export function unsupportedNumbers(text, sourceTexts) {
  const numbers = numbersIn(text);
  if (!numbers.length) return [];
  const currencyNumbers = new Set(currencyNumbersIn(text));
  const searchables = (sourceTexts || []).map(toSearchable);
  return numbers.filter((n) => {
    if (currencyNumbers.has(n)) {
      return !searchables.some((s) => isCurrencySupportedIn(n, s));
    }
    return !searchables.some((s) => s.includes(n));
  });
}
