// The SHORT name an event row wears on the events hubs, in the page's language.
//
// Every card on /events/ used to print the whole SEO headline —
// "Céline Dion Paris Residency: Dates, Tickets & Venue (Paris)" — and then the
// city and country again underneath. The row already shows the city, the
// country and the dates, so the headline's tail is the same facts said twice
// (events redesign, 2026-09-24).
//
// English goes through eventSchemaName (the one the Event JSON-LD uses) and
// then the generic rules below. The translated titles are free translations —
// "셀린 디온 파리 레지던시: 일정, 티켓, 공연장 안내 (파리)", "BTS世界巡演——阿灵顿站须知（阿灵顿）"
// — so each language gets its own list of the boilerplate its titles end in.
//
// The rules only ever REMOVE a tail that is recognisably boilerplate. A title
// they do not recognise is returned whole: a long name is a cosmetic problem,
// a name cut in the wrong place ("罗兰・加洛斯之外的顶级赛事" — "the top event
// besides Roland-Garros" — for the Shanghai Masters) is a wrong one.
import { eventSchemaName } from './eventName.mjs';

// Separators a title's name/tail split can use.
const SEPS = ['——', ' — ', ' – ', ' - ', '：', ': ', ':', ', ', '，'];

// A tail after a separator is cut only when it STARTS like boilerplate.
const TAIL_START = {
  en: /^(?:what to know|dates\b|tickets\b|circuit location|a visitor|complete guide|ultimate guide|venue\b)/i,
  ko: /^(?:[^:,]{1,12}\s?(?:공연|경기|행사)\s?(?:일정|날짜|정보)|[^:,]{1,12}\s개최 정보|서킷 위치|미리 알아|알아|이것만은|참고|일정|티켓|날짜|공연 일정|공연 날짜|행사 일정|개최|안내|완벽|완전 정리|총정리|가이드|정보)/,
  ja: /^(?:事前に知って|知って|日程|開催|チケット|会場|観戦|公演日程|公演情報|完全ガイド|徹底ガイド|基礎知識|情報)/,
  es: /^(?:ubicaci[oó]n del circuito|(?:todo )?lo que|fechas|entradas|recinto|sede|gu[ií]a)/i,
  zh: /^(?:[^：:，,、]{0,8}?(?:站|场|赛事)?(?:日期|时间|演出日期|你需要|须知|观赛指南|观演指南|场次须知)|赛道位置|赛事须知|日期|时间|门票|场馆|场地|赛程|赛事日期|演出日期|演出时间|举办日期|举办地|展期|场次|名额|观展|观演|观赛|出行|行前|预告|你需要|需要|须知|全攻略|攻略|指南|看点|\d{4}年时间)/,
};

// Boilerplate glued to the END of a title with no separator
// ("포스트 말론 마닐라 공연 총정리", "大相撲九月場所(秋場所)完全ガイド").
const END_PHRASE = {
  en: null,
  ko: /\s*(?:완벽 가이드|완벽 정리|완전 정리|총정리|알아두기|참고 정보|가이드|안내)$/,
  ja: /\s*(?:について知っておきたいこと|で知っておきたいこと|知っておきたいこと|開催情報まとめ|開催情報|情報まとめ|完全ガイド|徹底ガイド|基本ガイド|観戦ガイド|ガイド|基礎知識|まとめ|について|とは)$/,
  es: null,
  zh: /\s*(?:需要了解的信息|看点全解|预告须知|观演指南|观演须知|观赛指南|出行须知|行前须知|参赛指南|完全指南|攻略指南|全攻略|指南|须知|需知)$/,
};

// A trailing "(City)" / "（城市）" — the row prints the city in its own column.
const TRAILING_PAREN = /\s*[(（][^()（）]*[)）]\s*$/;
const TRAILING_JUNK = /[\s:：、,，·—–-]+$/;

/**
 * @param {string} title  the title in `lang` (English title when lang is 'en')
 * @param {'en'|'ko'|'ja'|'es'|'zh'} lang
 * @returns {string}
 */
export function eventShortName(title, lang = 'en') {
  const full = String(title ?? '').trim();
  if (!full) return full;
  const L = TAIL_START[lang] ? lang : 'en';
  let s = L === 'en' ? eventSchemaName(full) : full;

  // Only a paren that closes the title AFTER something recognisable is
  // stripped, so try it and keep it only if a boilerplate cut follows.
  const unparen = s.replace(TRAILING_PAREN, '');
  let cut = false;

  // Every separator position, left to right; cut at the FIRST whose tail
  // starts like boilerplate. The last one is wrong for Korean and Spanish,
  // whose boilerplate is itself a comma list ("일정, 티켓, 공연장 안내").
  const positions = [];
  for (const sep of SEPS) {
    for (let i = unparen.indexOf(sep); i > 0; i = unparen.indexOf(sep, i + 1)) positions.push([i, sep]);
  }
  positions.sort((a, b) => a[0] - b[0] || b[1].length - a[1].length);
  for (const [i, sep] of positions) {
    const tail = unparen.slice(i + sep.length).trim();
    if (TAIL_START[L].test(tail)) {
      s = unparen.slice(0, i);
      cut = true;
      break;
    }
  }
  if (!cut && END_PHRASE[L]) {
    const t2 = unparen.replace(END_PHRASE[L], '');
    if (t2 !== unparen) {
      s = t2;
      cut = true;
    }
  }
  // After a separator cut the head may itself end in glued boilerplate
  // ("Stray Kids演唱会指南：首尔站…" → "Stray Kids演唱会指南" → "Stray Kids演唱会").
  if (cut && END_PHRASE[L]) s = s.replace(END_PHRASE[L], '');
  s = s.replace(TRAILING_JUNK, '').trim();
  // Never shorter than something a reader can recognise.
  return [...s].length >= 2 ? s : full;
}
