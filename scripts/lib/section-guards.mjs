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
  /\bhere it is\b/i,
  /\bhere'?s the section\b/i,
  /\bi found\b/i,
  // Talking to the reader about our own sourcing: "none of these are covered
  // by the source used here", "no equivalent detail available here". The
  // reader came for the country, not for a note on what we managed to fetch.
  /\bthe sources? used here\b/i,
  /\bavailable here for\b/i,
  /\bcovered by the sources?\b/i,
  /\bno (?:equivalent|further) detail\b/i,
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

// Multi-character symbols first so "HK$100" / "S$12" / "US$5" are recognized
// as a single currency token, though matching just the bare "$" would already
// be enough to flag the position as currency-adjacent.
const CURRENCY_PREFIXED_SYMBOLS = ['HK\\$', 'NT\\$', 'S\\$', 'US\\$'];
// One bare symbol per remaining active-country currency that isn't already
// covered by a prefixed or letter marker below (round 3, 2026-09-05 review:
// ₫, ₹, Rp and UZS were unrecognised and fell through to the loose rule).
const CURRENCY_BARE_SYMBOLS = ['¥', '\\$', '€', '£', '₩', '฿', '₹', '₺', '₫', '₱', '៛', '元'];

// Letter markers (codes and words) use lookaround instead of \b: a code is
// routinely glued directly to its digits with no space ("1000JPY",
// "12THB"), and \w includes digits, so a digit-letter join is never a \b
// boundary. The lookaround only rejects a LETTER on either side, so "1000JPY"
// still matches while "arm"/"form"/"wonder" do not falsely match JPY/won.
const CURRENCY_LETTER_MARKERS = [
  'AED', 'USD', 'JPY', 'EUR', 'THB', 'KRW', 'CNY', 'RMB', 'TWD', 'HKD',
  'SGD', 'INR', 'VND', 'IDR', 'MYR', 'PHP', 'UZS', 'TL', 'Rs\\.?',
  'yen', 'won', 'baht', 'euros?', 'dollars?', 'rupees?', 'dirhams?', 'pesos?',
  'yuan', 'ringgit', 'rupiah', 'dong', 'riel', 'lira',
];

// Words that double as ordinary English (or, for "Rp"/"RM", as a token that
// can sit glued next to unrelated text) are not made safe by a letter
// boundary alone — "Rome", "the RM went missing", "handsome", "consume" and
// "I'll try 5 times" all pass a plain letter-boundary check. These count as
// a currency marker only when a digit sits on one side, at most one space
// away, which a stray word in prose essentially never has.
const CURRENCY_AMBIGUOUS_WORDS = ['Rp', 'RM', "so'm", 'som', 'sum', 'TRY'];
const CURRENCY_AMBIGUOUS_MARKER = CURRENCY_AMBIGUOUS_WORDS
  .map((w) => `(?:(?<=\\d\\s{0,1})${w}(?![A-Za-z])|(?<![A-Za-z])${w}(?=\\s{0,1}\\d))`)
  .join('|');

const CURRENCY_MARKER = '(?:' + [
  ...CURRENCY_PREFIXED_SYMBOLS,
  CURRENCY_AMBIGUOUS_MARKER,
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

// ─── Where a fact is allowed to come from ────────────────────────────────
// A bag-drop startup's own marketing page is not a source. It answers 200,
// so the link check passes it, and its numbers are in its own text, so the
// number check passes too — which is how South Korea's first draft came to
// publish "273 stations with 5,557+ lockers" and a ₩3,999 price lifted
// straight from a vendor's sales copy. Rail operators, airport authorities
// and tourism boards state the same mechanics without selling anything.
const COMMERCIAL_STORAGE_HOSTS = [
  'stasher.com', 'radicalstorage.com', 'nannybag.com', 'bounce.com', 'usebounce.com',
  'luggagehero.com', 'bagbnb.com', 'vertoe.com', 'ecbo.io', 'citystasher.com',
  'luggageterminal.com', 'bagsaway.com', 'lockerpoint.com', 'bagagesdumonde.com',
  'qeepl.com', 'lalalocker.com', 'fesindo.com',
];

// The other kind of page that is not a source: someone else's write-up. The
// Cambodia draft cited an airport-sleeping blog and produced a paragraph of
// "some travellers report" — the second-hand voice we are here to replace.
const AGGREGATOR_HOSTS = [
  'sleepinginairports.net', 'tripadvisor.com', 'tripadvisor.co.uk', 'reddit.com',
  'wikitravel.org', 'wikivoyage.org', 'lonelyplanet.com', 'klook.com', 'kkday.com',
  'getyourguide.com', 'viator.com', 'agoda.com', 'booking.com', 'expedia.com',
  'medium.com', 'blogspot.com', 'wordpress.com', 'quora.com', 'tripsavvy.com',
  'thecrazytourist.com', 'nomadicmatt.com', 'timeout.com', 'culturetrip.com',
  'airport.online', 'mightytravels.com', 'sleepinginairports.com',
  'travelchinaguide.com', 'italiarail.com', 'klia.info', 'klia2.info',
  'klia2.com.my', 'klsentral.info', 'seat61.com', 'rome2rio.com',
  'betternaia.com', 'boxnlok.vn', 'airwise.com', 'hongkongcheapo.com',
  'topchinatravel.com', 'tashkenttimes.uz', 'uzdaily.uz',
];

/** The subset of `urls` that are commercial storage vendors selling the very
 *  thing the section describes. Callers drop these links before publishing. */
export function commercialSources(urls) {
  return (urls || []).filter((u) => {
    let host;
    try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
    return [...COMMERCIAL_STORAGE_HOSTS, ...AGGREGATOR_HOSTS]
      .some((bad) => host === bad || host.endsWith(`.${bad}`));
  });
}

// ─── How the section is allowed to read ──────────────────────────────────
const MARKETING_PHRASES = [
  'excellent security', 'professional companies', 'strategically located',
  'state-of-the-art', 'peace of mind', 'conveniently located', 'seamless',
  'hassle-free', 'world-class', 'wide range of options', 'round-the-clock',
  'travelers with', 'ensuring', 'nestled',
];

const MAX_WORDS = 220;

/** Problems that make a drafted section unpublishable regardless of whether
 *  its numbers check out: vendor sales voice, headline statistics, dollar
 *  conversions nobody can verify, or a wall of text where two short
 *  paragraphs were asked for. Returns [] when the draft is clean. */
export function proseProblems(text, { allowUsd = false, dollarCurrency = false } = {}) {
  const problems = [];
  const body = text.split(/^Sources:/m)[0].trim();

  const words = body.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) problems.push(`too long (${words} words, max ${MAX_WORDS})`);

  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length !== 2) problems.push(`${paragraphs.length} paragraph(s), expected 2`);

  const lower = body.toLowerCase();
  for (const phrase of MARKETING_PHRASES) {
    if (lower.includes(phrase)) problems.push(`marketing phrase "${phrase}"`);
  }

  // "5,557+ lockers", "273 stations", "10+ points" — vendor headline numbers.
  // Prices and durations stay: a currency-marked figure is checked elsewhere,
  // and no fee or opening hour needs four digits without a currency on it.
  // currencyNumbersIn strips thousands separators, so compare on bare digits —
  // otherwise "¥800–1,000" reads as a headline count instead of the price it is.
  const currency = new Set(currencyNumbersIn(body));
  const isPrice = (n) => currency.has(n.replace(/,/g, ''));
  for (const m of body.matchAll(/(\d[\d,]*)\+/g)) {
    if (!isPrice(m[1])) problems.push(`headline count "${m[0]}"`);
  }
  for (const m of body.matchAll(/\b(\d{1,3},\d{3}|\d{4,})\b/g)) {
    if (!isPrice(m[1]) && !/^(19|20)\d\d$/.test(m[1])) problems.push(`headline count "${m[1]}"`);
  }

  // France's draft named "Bagages du Monde" three times and then listed that
  // company's coat storage, scooter rental and sightseeing tickets. A section
  // that says one operator's name over and over has stopped describing the
  // country and started reproducing a brochure.
  const nameCounts = new Map();
  for (const m of body.matchAll(/\b([A-Z][\w&'’-]*(?:[ ](?:[A-Z][\w&'’-]*|du|de|del|van))+)/g)) {
    const n = m[1].trim();
    nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
  }
  for (const [name, n] of nameCounts) {
    if (n >= 3) problems.push(`"${name}" named ${n} times — reads as one operator's brochure`);
  }

  // Singapore, Hong Kong and Taiwan price things in their own dollars, so a
  // "$" is not evidence of a conversion there — only an explicit US dollar is.
  // Elsewhere any "$" figure is a conversion, and conversions go stale.
  const usdOnly = /(US\$|\bUSD\b)/.test(body);
  if (!allowUsd && (usdOnly || (!dollarCurrency && /\$\s?\d/.test(body)))) {
    problems.push('dollar conversion (rates move; the local price is the fact)');
  }

  return [...new Set(problems)];
}

// ─── Names the sources never mention ─────────────────────────────────────
// Thailand's draft named "LOCK BOX Bangkok", "Blocker" and "Nannybag" as
// operators. Its two surviving sources — the airport's own page and the BTS
// site — mention none of them. A brand nobody can check is the same invented
// detail as a price nobody can check, so proper nouns are held to the rule
// the numbers already follow: it appears in a source, or it does not appear.
const NAME_STOPWORDS = new Set([
  'A', 'An', 'And', 'At', 'Beyond', 'But', 'By', 'Coin', 'Expect', 'For', 'From',
  'Hotels', 'If', 'In', 'It', 'Lockers', 'Luggage', 'Most', 'Older', 'On', 'Or',
  'Prices', 'Rates', 'Storage', 'The', 'There', 'These', 'They', 'This', 'To',
  'Travellers', 'Travelers', 'When', 'Where', 'While', 'You', 'Your',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
]);

/** Proper nouns in the section body that appear in none of its own sources.
 *  Single words that merely start a sentence are ignored — they are ordinary
 *  words wearing a capital. Returns [] when every name is accounted for. */
export function unsupportedNames(text, sourceTexts) {
  const body = text.split(/^Sources:/m)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // link text stays, URLs go
    .replace(/['’]s\b/g, ' ');                  // "Bangkok's BTS" is two names
  const haystacks = (sourceTexts || []).map((t) => (t || '').toLowerCase());
  const found = new Map();

  // Capitalised runs only. Letting "of" join two runs produced the phantom
  // "Miami International Airport of" and refused a country over it.
  const re = /\b([A-Z][\w&'’-]*(?:[ ][A-Z][\w&'’-]*)*)/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].trim();
    const words = name.split(/\s+/);
    const startsSentence = m.index === 0 || /[.!?]\s+$|^\s*$|\n\s*$/.test(body.slice(Math.max(0, m.index - 3), m.index));
    if (words.length === 1 && (startsSentence || NAME_STOPWORDS.has(name))) continue;
    if (words.length === 1 && name.length < 3) continue;
    if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), name);
  }

  return [...found.values()].filter((name) => {
    const needle = name.toLowerCase();
    if (haystacks.some((h) => h.includes(needle))) return false;
    // A multi-word name has to appear as that name. Accepting it because each
    // of its words appears somewhere on some page is how "LOCK BOX Bangkok"
    // passed on the strength of "box" and "bangkok".
    const words = needle.split(/\s+/);
    if (words.length === 1) return true;
    // …with one concession: a name whose leading word is a qualifier ("Multi
    // Ecube", "Greater Tokyo") counts when the rest of it appears verbatim.
    return !haystacks.some((h) => h.includes(words.slice(1).join(' ')));
  });
}

/** Drop the model's opening aside ("I have enough information now to write
 *  this. Here it is:") when it sits in front of the section proper. Only
 *  LEADING sentences are removed, and only while every one of them is meta —
 *  a monologue that resurfaces mid-paragraph still means an unfinished draft,
 *  and metaTextIn refuses that as before. */
export function stripLeadingMeta(text) {
  let out = String(text).trim();
  for (;;) {
    const m = /^[^.!?:\n]*[.!?:](\s+|$)/.exec(out);
    if (!m) break;
    const sentence = m[0];
    if (!metaTextIn(sentence)) break;
    out = out.slice(sentence.length).trimStart();
  }
  return out;
}
