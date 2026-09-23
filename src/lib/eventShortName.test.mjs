// node --test src/lib/eventShortName.test.mjs
// Real titles from src/content/posts and src/content/i18n (2026-09-24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventShortName } from './eventShortName.mjs';

const cases = {
  en: [
    ['Céline Dion Paris Residency: Dates, Tickets & Venue (Paris)', 'Céline Dion Paris Residency'],
    ['Formula E Tokyo E-Prix 2026: Circuit Location, Dates & Access (Tokyo)', 'Formula E Tokyo E-Prix 2026'],
    ['Harry Styles Residency – Madison Square Garden: What to Know (New York)', 'Harry Styles Residency – Madison Square Garden'],
    ['UFC Fight Night: Ankalaev vs Rountree Jr: What to Know (Abu Dhabi)', 'UFC Fight Night: Ankalaev vs Rountree Jr'],
    ['China Open (tennis): Dates, Tickets & Venue (Beijing)', 'China Open (tennis)'],
    ['Lantern Festival in Jinju', 'Lantern Festival in Jinju'],
  ],
  ko: [
    ['셀린 디온 파리 레지던시: 일정, 티켓, 공연장 안내 (파리)', '셀린 디온 파리 레지던시'],
    ['포스트 말론 마닐라 공연 총정리 (보카우에)', '포스트 말론 마닐라 공연'],
    ['어벤지드 세븐폴드 아시아 투어 2026: 방콕 공연 일정, 티켓, 공연장 안내', '어벤지드 세븐폴드 아시아 투어 2026'],
    ['요코 오노: 인사운드 앤 인스트럭처 - 날짜, 티켓 및 전시장 안내 (이스탄불)', '요코 오노: 인사운드 앤 인스트럭처'],
    ['진주 남강 유등 축제', '진주 남강 유등 축제'],
  ],
  ja: [
    ['大相撲九月場所(秋場所)完全ガイド(東京)', '大相撲九月場所(秋場所)'],
    ['時代祭:日程・チケット・会場情報(京都)', '時代祭'],
    ['BTSワールドツアー アーリントン公演で知っておきたいこと(アーリントン)', 'BTSワールドツアー アーリントン公演'],
  ],
  es: [
    ['Residencia de Céline Dion en París: Fechas, Entradas y Recinto (París)', 'Residencia de Céline Dion en París'],
    ['Pestapora 2026: Lo que hay que saber (Yakarta)', 'Pestapora 2026'],
    ['Navidad en Alsacia', 'Navidad en Alsacia'],
  ],
  zh: [
    ['席琳·迪翁巴黎驻演：演出日期、门票与场馆信息（巴黎）', '席琳·迪翁巴黎驻演'],
    ['BTS世界巡演——阿灵顿站须知（阿灵顿）', 'BTS世界巡演'], // the city is in its own column
    ['Stray Kids演唱会指南：首尔站你需要知道的事', 'Stray Kids演唱会'],
    ['2026年亚运会：名古屋赛事日期、门票与场馆指南', '2026年亚运会'],
  ],
};

for (const [lang, list] of Object.entries(cases)) {
  test(`${lang}: boilerplate tail comes off, the name stays`, () => {
    for (const [title, want] of list) assert.equal(eventShortName(title, lang), want, title);
  });
}

test('never cuts at a separator whose tail is part of the name', () => {
  // "The top event besides Roland-Garros: ATP Shanghai Masters …" — cutting at
  // the colon would name the Shanghai Masters "the top event besides Roland-Garros".
  const zh = '罗兰・加洛斯之外的顶级赛事：ATP上海大师赛（网球大师赛）时间、门票与场馆指南（上海）';
  assert.match(eventShortName(zh, 'zh'), /ATP上海大师赛/);
  // A Korean title whose colon tail is the event's own subtitle.
  assert.equal(eventShortName('UFC 파이트 나이트: 안칼라예프 vs 라운트리 주니어, 알아둘 사항 (아부다비)', 'ko'),
    'UFC 파이트 나이트: 안칼라예프 vs 라운트리 주니어');
});

test('empty and degenerate input falls back to the title', () => {
  assert.equal(eventShortName('', 'en'), '');
  assert.equal(eventShortName(undefined, 'ko'), '');
  assert.equal(eventShortName('What to Know', 'en'), 'What to Know');
  // Unknown language uses the English rules rather than throwing.
  assert.equal(eventShortName('Aloha Festivals: Dates, Tickets & Venue (Honolulu)', 'fr'), 'Aloha Festivals');
});
