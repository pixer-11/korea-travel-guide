// ─────────────────────────────────────────────────────────────
//  A PLACE NAME, NOT AN ARTICLE HEADLINE.
//
//  The when-to-go quiet lists and the itinerary stop lists show places. The
//  post title is "<place>: <region> Travel Guide (4.7★)", so both trimmed it
//  with `.split(/[:—]/)[0]` — which works in English and Spanish and fails in
//  ko/ja/zh for two reasons at once:
//
//    · the separator is FULL-WIDTH there — 「巴戎寺：暹粒旅行指南（4.8星）」 —
//      and U+FF1A is not U+003A.
//    · often there is no separator at all: 「東京タワー旅行ガイド」,
//      「나라 공원(Nara Park) 여행 가이드」.
//
//  Measured 2026-09-10, before this existed: zh printed the whole headline on
//  80 of 120 when-to-go entries and 42 of 50 itinerary stops; ja 39 and 16; ko
//  16 and 12; en and es zero, which is why it went unnoticed. One stop even
//  contradicted the rating chip beside it — 「카통 파크 여행 가이드 (4.1★)」
//  next to ★4.2, because the leaked headline carried an older snapshot.
// ─────────────────────────────────────────────────────────────

// Half- and full-width separators, in the order a title uses them.
const SEPARATORS = /[:\uff1a\u2014\u2013\uff5c|]/;

// What each language appends to a place name to make an article title. Longest
// first: 완전 가이드 must be tried before 가이드.
const SUFFIXES = {
  ko: ['여행 가이드', '완전 가이드', '가이드'],
  ja: ['旅行ガイド', '完全ガイド', 'ガイド'],
  zh: ['旅行指南', '完整指南', '指南'],
  es: ['Guía de viaje', 'Guía'],
  en: ['Travel Guide', 'Guide'],
};

// A trailing rating, in either width: (4.7★) （評価4.7★） （4.8星）
const TRAILING_RATING = /[(\uff08][^)\uff09]*[\u2605\u661f][^)\uff09]*[)\uff09]\s*$/;

/**
 * The place name a list should show, given a post title.
 * @param {string} title  the post title, already localized
 * @param {string} lang   en | ko | ja | es | zh
 */
export function shortPlaceLabel(title, lang) {
  let out = String(title ?? '').split(SEPARATORS)[0].trim();
  out = out.replace(TRAILING_RATING, '').trim();
  for (const suffix of SUFFIXES[lang] ?? []) {
    if (!out.endsWith(suffix)) continue;
    const cut = out.slice(0, -suffix.length).trim();
    // Never trim away the whole label: a place actually called "가이드" keeps it.
    if (cut) out = cut;
    break;
  }
  return out.replace(TRAILING_RATING, '').trim();
}
