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
  // 攻略 forms added 2026-09-24: 「契迪龙寺完全攻略」「曼谷国际舞蹈与音乐节全攻略(曼谷)」
  // printed whole on the country hub's city cards and event list.
  zh: ['旅行指南', '完全攻略', '完整指南', '全攻略', '攻略', '指南'],
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
// A trailing "(City)" AFTER the suffix: 「大相撲九月場所(秋場所)完全ガイド(東京)」.
// Only removed when a known suffix sits right in front of it — 「(秋場所)」 in
// the middle of that same title is part of the event's name and stays.
const TRAILING_PAREN = /\s*[(（][^()（）]*[)）]\s*$/;

export function shortPlaceLabel(title, lang) {
  let out = String(title ?? '').split(SEPARATORS)[0].trim();
  out = out.replace(TRAILING_RATING, '').trim();
  const bare = out.replace(TRAILING_PAREN, '').trim();
  if (bare !== out && (SUFFIXES[lang] ?? []).some((s) => bare.endsWith(s) && bare.length > s.length)) out = bare;
  for (const suffix of SUFFIXES[lang] ?? []) {
    if (!out.endsWith(suffix)) continue;
    const cut = out.slice(0, -suffix.length).trim();
    // Never trim away the whole label: a place actually called "가이드" keeps it.
    if (cut) out = cut;
    break;
  }
  return out.replace(TRAILING_RATING, '').trim();
}

// ─────────────────────────────────────────────────────────────
//  THE CITY IN FRONT OF THE COLON.
//
//  A translation now and then turns "Yakiuo Ishikawa: Ho Chi Minh City Travel
//  Guide" round into 「호찌민 여행 가이드: 야키우오 이시카와」. shortPlaceLabel
//  then reads the city as the place, and the in-body linker (body-links.mjs)
//  sent the first "호찌민" on every Korean page in Vietnam to a sushi bar
//  (found 2026-10-20 by the owner on a fresh guide). 57 titles across ko, ja,
//  zh and es had the city in front.
//
//  The city cannot be told from the title alone — 「페낭 식물원 여행 가이드:
//  …」 puts the PLACE in front and is fine — so both helpers below take the
//  set of names this region goes by (regionNamesFor).
// ─────────────────────────────────────────────────────────────

// Only the long travel-guide suffix marks a reversed title: 「巴厘岛美食指南：…」
// is a food guide with a subtitle, not a city.
const TRAVEL_GUIDE = { ko: ['여행 가이드'], ja: ['旅行ガイド'], zh: ['旅行指南', '旅游指南'] };

const RATING_INSIDE = /^(.*?)\s*[(（]([^()（）]*?)[,，、]\s*([0-9][.,][0-9]\s*[★星])\s*[)）]\s*$/u;

/**
 * The city part of a normal "<place>: <city> Travel Guide" title, or ''.
 * Siblings' titles are where the translated city name actually lives: the
 * place table says 호치민 while the guides say 호찌민.
 */
export function guideTitleRegion(title, lang) {
  const t = String(title ?? '').replace(TRAILING_RATING, '').trim();
  const m = t.match(SEPARATORS);
  if (!m) return '';
  const tail = t.slice(m.index + 1).trim();
  for (const suffix of SUFFIXES[lang] ?? []) {
    const low = tail.toLowerCase(), s = suffix.toLowerCase();
    if (!low.endsWith(s)) continue;
    let city = tail.slice(0, -suffix.length).trim();
    if (lang === 'es') city = city.replace(/^de\s+/i, '').trim();
    return city;
  }
  // es reads "guía de viaje de Berlín": the suffix comes first.
  if (lang === 'es') {
    const es = tail.match(/^gu[ií]a(?: de viaje)?\s+de\s+(.+)$/i);
    if (es) return es[1].trim();
  }
  return '';
}

/** Every name a region goes by, lower-cased, for one language. */
export function regionNamesFor(names) {
  return new Set([...names].filter(Boolean).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
}

/**
 * 「<city> 여행 가이드: <place>」 → 「<place>: <city> 여행 가이드」, or null when the
 * title is not that shape. `cityNames` from regionNamesFor; es titles that open
 * on the bare suffix ("Guía de viaje: X") are turned round with `cityLabel`.
 */
export function unreverseGuideTitle(title, lang, cityNames, cityLabel = '', { aboutCity = false } = {}) {
  // The guide IS the city (「下龙湾旅行指南：如何游览越南下龙湾」): the tail is a
  // subtitle and the head already names the place. Decided by the caller from
  // the English source (isAboutCity), not guessed from the tail: 「바스 여행
  // 가이드: 로만 바스」 carries the city inside the place's own name.
  if (aboutCity) return null;
  const raw = String(title ?? '');
  const m = raw.match(SEPARATORS);
  if (!m) return null;
  const head = raw.slice(0, m.index).trim();
  let rest = raw.slice(m.index + 1).trim();
  let rating = '';
  const inside = rest.match(RATING_INSIDE);
  const tr = inside ? null : rest.match(TRAILING_RATING);
  if (tr) { rating = tr[0].trim(); rest = rest.slice(0, tr.index).trim(); }
  if (inside) { rest = `${inside[1]}${lang === 'ko' || lang === 'es' ? ' (' : '（'}${inside[2].trim()}${lang === 'ko' || lang === 'es' ? ')' : '）'}`; rating = lang === 'ko' || lang === 'es' ? `(${inside[3]})` : `（${inside[3]}）`; }
  if (!rest) return null;
  const sep = lang === 'ja' || lang === 'zh' ? '：' : ': ';
  const gap = rating ? (lang === 'ja' || lang === 'zh' ? '' : ' ') : '';
  if (lang === 'es' && /^gu[ií]a de viaje$/i.test(head)) {
    return `${rest}${sep}guía de viaje${cityLabel ? ` de ${cityLabel}` : ''}${gap}${rating}`;
  }
  for (const suffix of TRAVEL_GUIDE[lang] ?? []) {
    if (!head.toLowerCase().endsWith(suffix.toLowerCase())) continue;
    let city = head.slice(0, -suffix.length).trim();
    // 「ナントの旅行ガイド」: the stray の goes with the turn.
    const ja = lang === 'ja' && city.endsWith('の');
    if (ja) city = city.slice(0, -1);
    if (!city || !cityNames.has(city.toLowerCase())) return null;
    return `${rest}${sep}${ja ? city + suffix : head}${gap}${rating}`;
  }
  return null;
}

// Generic words that do not tell two names apart: "Phi Phi Islands" and
// "Koh Phi Phi", "Halong Bay" and "Ha Long Bay" are one place.
const GENERIC = /\b(the|koh|ko|islands?|bay|city|town|old|province)\b/g;
const bare = (s) => String(s ?? '').toLowerCase().replace(GENERIC, '').replace(/[^\p{L}\p{N}]/gu, '');

/** Is this guide about its region itself? From the ENGLISH title and region. */
export function isAboutCity(englishTitle, region) {
  const place = bare(shortPlaceLabel(englishTitle, 'en'));
  const city = bare(region);
  return !!place && !!city && place === city;
}