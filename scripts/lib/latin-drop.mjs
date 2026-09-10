// ─────────────────────────────────────────────────────────────
//  AN ENGLISH WORD WHERE A CJK WORD BELONGS.
//
//  2026-09-07..09 the translator started emitting the English GLOSS of a word
//  instead of the word. Not a truncation and not a leak of untranslated
//  sentences — a substitution inside an otherwise fluent sentence, which is why
//  every existing checker walked past it:
//
//    浅草寺:東京observation旅行ガイド   (観光 → "observation")   ← the <title>
//    浅草寺(645年completion)            (建立 → "completion")
//    阿波羅long廊                        (长 → "long")
//    금박 → "golded"                     (not even an English word)
//
//  audit-translations is deliberately paragraph-level and says so: "place
//  names, brand names and short Latin fragments are normal". audit-i18n-leaks
//  samples six pages per type per language. Neither could see a single word.
//
//  The prompt did not change in this window (git: no edit to the rules since
//  2026-09-01), so this is model drift under volume, and a prompt tweak is not
//  a fix — a gate is.
//
//  WHAT THIS DELIBERATELY DOES NOT FLAG, because all three are correct:
//    · an acronym or a capitalised proper noun taking a particle — UAE에,
//      MTR입, Fils의. Only an all-lowercase run counts.
//    · anything inside parentheses — the prompt asks for the original name in
//      parentheses on first mention, so (Ajman Museum) is the rule working.
//    · a loanword the language actually uses — jazz, cafe, halal, ramen.
//    · Spanish. It is Latin script; this test is meaningless there.
// ─────────────────────────────────────────────────────────────

/** Languages whose script makes a bare lowercase Latin run visible as a defect. */
export const CJK_LANGS = ['ko', 'ja', 'zh'];

const CJK = '\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af';

// A lowercase run of 4+ letters touching a CJK character, and not part of a
// longer Latin word (so the tail of "Kareem" or "Bureau" never matches).
const GLUED = new RegExp(
  '[' + CJK + '][a-z]{4,}(?![A-Za-z])|(?<![A-Za-z])[a-z]{4,}[' + CJK + ']',
  'g',
);
// The same word standing alone between two CJK characters.
const FLOATING = new RegExp('[' + CJK + '] [a-z]{4,} [' + CJK + ']', 'g');

// Only a parenthetical that is ENTIRELY Latin is the prompt's proper-noun
// gloss — (Ajman Museum). One that mixes scripts is not an exemption:
// 「(645年completion)」 is the defect wearing brackets, and stripping every
// bracket hid it on the first pass of this very file.
const LATIN_ONLY_PARENS = /[(（][ -~]*[)）]/g;

// The defect is an ENGLISH word standing in for a translated one. A foreign
// proper noun or a borrowed dish name written in Latin script is not that — it
// is how these languages write those things, and flagging them made the gate
// retry perfectly good translations three times and then throw them away
// (2026-09-10: aespa, hyukoh, warung, panellets, omakase, cortado, lumpia,
// robatayaki, almadraba, tambang all reached the model as "defects").
//
// So the test is no longer "is this Latin?" but "is this an ordinary English
// word?" — checked against a list of the ones a translator actually drops. It
// is a closed list on purpose: a word not on it is assumed to be a name, which
// is the safe direction. Grow it when a real drop is found in the wild.
export const ENGLISH_WORDS = new Set([
  // seen dropped in the 2026-09-07..09 regression
  'observation', 'completion', 'construction', 'historical', 'historic', 'family',
  'market', 'price', 'level', 'forest', 'railway', 'station', 'village', 'castle',
  'garden', 'temple', 'shrine', 'museum', 'gallery', 'tower', 'bridge', 'harbor',
  'harbour', 'district', 'street', 'avenue', 'square', 'palace', 'island', 'beach',
  'mountain', 'river', 'lake', 'park', 'long', 'short', 'best', 'good', 'great',
  'small', 'large', 'wide', 'high', 'deep', 'quiet', 'busy', 'early', 'late',
  'morning', 'evening', 'afternoon', 'night', 'summer', 'winter', 'spring',
  'autumn', 'weekday', 'weekend', 'holiday', 'ticket', 'entrance', 'exit',
  'opening', 'closing', 'walking', 'drop-off', 'headliner', 'recreation',
  'observation', 'reservation', 'admission', 'discount', 'souvenir', 'viewpoint',
  'lookout', 'waterfall', 'hillside', 'seaside', 'downtown', 'uptown', 'gilded',
  'golded', 'nearby', 'inside', 'outside', 'upstairs', 'downstairs',
]);

// Words these languages genuinely write in Latin script (kept for the older
// call path; ENGLISH_WORDS is what decides now).
export const LOANWORDS = new Set([
  'jazz', 'cafe', 'wifi', 'esim', 'halal', 'ramen', 'sushi', 'tapas', 'vegan',
  'brunch', 'bagel', 'techno', 'house', 'pintxo', 'pintxos', 'vermut', 'craft',
]);

/**
 * The English words standing where a translated word belongs.
 * @param {string} text  the translated body or a single field
 * @param {string} lang  ko | ja | zh — anything else returns []
 * @returns {string[]} the offending fragments, in order, deduplicated
 */
export function latinDrops(text, lang) {
  if (!CJK_LANGS.includes(String(lang))) return [];
  const stripped = String(text ?? '').replace(LATIN_ONLY_PARENS, ' ');
  const found = [
    ...[...stripped.matchAll(GLUED)].map((m) => m[0]),
    ...[...stripped.matchAll(FLOATING)].map((m) => m[0].trim()),
  ];
  const out = [];
  for (const frag of found) {
    const word = frag.match(/[a-z]{4,}/)?.[0];
    if (!word || !ENGLISH_WORDS.has(word)) continue;
    // The tail of a Latin phrase, not a dropped word. A romanised address keeps
    // its lowercase parts and takes a particle exactly like this:
    //   "186 Jeonseo-ro, Pungcheon-myeon에"  ·  "Chatuchak district에"
    //   "Amer road, Amber road로"
    // All three are correct Korean, and all three matched on the first pass.
    // If what stands immediately before the word is another Latin word or a
    // hyphen, the word belongs to that phrase.
    const at = stripped.indexOf(frag);
    const before = at > 0 ? stripped.slice(Math.max(0, at - 40), at + frag.indexOf(word)) : '';
    // Accented letters count as Latin here, or the ASCII tail of Celestins,
    // Defense and Vestibulo reads as a dropped word.
    if (/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ-]*[ ,-]$/.test(before)) continue;
    if (/[A-Za-zÀ-ɏ]$/.test(before)) continue;
    if (!out.includes(frag)) out.push(frag);
  }
  return out;
}
