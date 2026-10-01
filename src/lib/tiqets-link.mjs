// ─────────────────────────────────────────────────────────────
//  "할 거리·입장권" 버튼 — 유럽·미국·중동 도시는 Tiqets 로 보낸다.
//
//  2026-10-01 픽서님 대시보드 확인: GetYourGuide·Viator(8%)는 "3개월 연속
//  트래픽" 심사에 잠겨 있고, 같은 계정에서 **Tiqets(3.5–8%, 쿠키 30일)는
//  연결돼 있다**. Klook(2–5%)은 아시아에 강하고 유럽·미국 상품은 얇다 →
//  이 지역은 Tiqets 가 같은 클릭에 더 많이 번다. 아시아·호주는 Klook 그대로.
//
//  링크 형식은 Travelpayouts 딥링크(p=2074 Tiqets, campaign_id=89).
//  curl 로 확인(10-01): 302 → tiqets.com/…?partner=travelpayouts.com&
//  tq_campaign=<토큰>-754088 — 마커가 붙어 도착한다. sub_id 도 받는다.
//
//  도시 표는 **추측이 아니라** Tiqets 자체 사이트맵(site-map-city-en.xml.gz,
//  200개 도시)과 글의 region 이름을 맞춘 것. 각 페이지를 열어 그 나라
//  이름이 실제로 나오는지 확인했다(톨레도·코르도바·발렌시아·버밍엄 등
//  동명 도시 함정). 표에 없는 도시는 null → 부르는 쪽이 Klook 으로 간다.
//  slug 는 영어판 것이지만 /ko/·/ja/·/es/·/zh/ 로 바꿔도 Tiqets 가 그 언어
//  주소로 리다이렉트한다(10-01 확인, es 는 atracciones-paris-c66746).
//  새 나라·도시가 생기면: 사이트맵에서 같은 방식으로 찾아 한 줄씩 추가.
// ─────────────────────────────────────────────────────────────

export const TIQETS_CITY = {
  // France
  "Bordeaux": { id: 67101, slug: "bordeaux-attractions-c67101", country: "France" },
  "Colmar": { id: 67027, slug: "colmar-attractions-c67027", country: "France" },
  "Lyon": { id: 66838, slug: "lyon-attractions-c66838", country: "France" },
  "Marseille": { id: 66825, slug: "marseille-attractions-c66825", country: "France" },
  "Nantes": { id: 66776, slug: "nantes-attractions-c66776", country: "France" },
  "Nice": { id: 66770, slug: "nice-attractions-c66770", country: "France" },
  "Paris": { id: 66746, slug: "things-to-do-in-paris-c66746", country: "France" },
  "Toulouse": { id: 66619, slug: "toulouse-attractions-c66619", country: "France" },
  // Italy
  "Bologna": { id: 71986, slug: "bologna-attractions-c71986", country: "Italy" },
  "Florence": { id: 71854, slug: "florence-attractions-c71854", country: "Italy" },
  "Genoa": { id: 71831, slug: "genoa-attractions-c71831", country: "Italy" },
  "Milan": { id: 71749, slug: "milan-attractions-c71749", country: "Italy" },
  "Naples": { id: 71720, slug: "naples-attractions-c71720", country: "Italy" },
  "Palermo": { id: 71428, slug: "palermo-attractions-c71428", country: "Italy" },
  "Pisa": { id: 260935, slug: "pisa-attractions-c260935", country: "Italy" },
  "Rome": { id: 71631, slug: "rome-attractions-c71631", country: "Italy" },
  "Siena": { id: 71558, slug: "siena-attractions-c71558", country: "Italy" },
  "Turin": { id: 71534, slug: "turin-attractions-c71534", country: "Italy" },
  "Venice": { id: 71510, slug: "venice-attractions-c71510", country: "Italy" },
  "Verona": { id: 71506, slug: "verona-attractions-c71506", country: "Italy" },
  // Spain
  "Barcelona": { id: 66342, slug: "barcelona-attractions-c66342", country: "Spain" },
  "Cordoba": { id: 27, slug: "cordoba-attractions-c27", country: "Spain" },
  "Granada": { id: 66003, slug: "things-to-do-in-granada-c66003", country: "Spain" },
  "Madrid": { id: 66254, slug: "madrid-attractions-c66254", country: "Spain" },
  "Malaga": { id: 32, slug: "malaga-attractions-c32", country: "Spain" },
  "Seville": { id: 65870, slug: "seville-attractions-c65870", country: "Spain" },
  "Toledo": { id: 170113, slug: "toledo-attractions-c170113", country: "Spain" },
  "Valencia": { id: 65847, slug: "valencia-attractions-c65847", country: "Spain" },
  // Turkey
  "Antalya": { id: 78987, slug: "antalya-attractions-c78987", country: "Turkey" },
  "Bodrum": { id: 78967, slug: "bodrum-attractions-c78967", country: "Turkey" },
  "Istanbul": { id: 79079, slug: "istanbul-attractions-c79079", country: "Turkey" },
  // United Arab Emirates
  "Abu Dhabi": { id: 60013, slug: "abu-dhabi-attractions-c60013", country: "United Arab Emirates" },
  "Dubai": { id: 60005, slug: "dubai-attractions-c60005", country: "United Arab Emirates" },
  "Sharjah": { id: 60007, slug: "sharjah-attractions-c60007", country: "United Arab Emirates" },
  // United Kingdom
  "Belfast": { id: 67614, slug: "belfast-attractions-c67614", country: "United Kingdom" },
  "Birmingham": { id: 67597, slug: "birmingham-attractions-c67597", country: "United Kingdom" },
  "Brighton": { id: 67570, slug: "brighton-attractions-c67570", country: "United Kingdom" },
  "Edinburgh": { id: 21, slug: "edinburgh-attractions-c21", country: "United Kingdom" },
  "Glasgow": { id: 5, slug: "glasgow-attractions-c5", country: "United Kingdom" },
  "Liverpool": { id: 67463, slug: "liverpool-attractions-c67463", country: "United Kingdom" },
  "London": { id: 67458, slug: "london-attractions-c67458", country: "United Kingdom" },
  "Manchester": { id: 67441, slug: "manchester-attractions-c67441", country: "United Kingdom" },
  "Oxford": { id: 67381, slug: "oxford-attractions-c67381", country: "United Kingdom" },
  "York": { id: 67204, slug: "york-attractions-c67204", country: "United Kingdom" },
  // United States
  "Austin": { id: 80575, slug: "austin-attractions-c80575", country: "United States" },
  "Boston": { id: 80874, slug: "boston-attractions-c80874", country: "United States" },
  "Chicago": { id: 80816, slug: "chicago-attractions-c80816", country: "United States" },
  "East Rutherford": { id: 81223, slug: "east-rutherford-attractions-c81223", country: "United States" },
  "Honolulu": { id: 82342, slug: "honolulu-attractions-c82342", country: "United States" },
  "Las Vegas": { id: 82073, slug: "las-vegas-attractions-c82073", country: "United States" },
  "Los Angeles": { id: 81810, slug: "los-angeles-attractions-c81810", country: "United States" },
  "Miami": { id: 79868, slug: "miami-attractions-c79868", country: "United States" },
  "Nashville": { id: 82353, slug: "nashville-attractions-c82353", country: "United States" },
  "New Orleans": { id: 80162, slug: "new-orleans-attractions-c80162", country: "United States" },
  "New York": { id: 260932, slug: "new-york-attractions-c260932", country: "United States" },
  "Philadelphia": { id: 80492, slug: "philadelphia-attractions-c80492", country: "United States" },
  "San Diego": { id: 81920, slug: "san-diego-attractions-c81920", country: "United States" },
  "San Francisco": { id: 1772, slug: "san-francisco-attractions-c1772", country: "United States" },
  "Seattle": { id: 82304, slug: "seattle-attractions-c82304", country: "United States" },
  "Washington DC": { id: 79751, slug: "washington-dc-c79751", country: "United States" },
};

const TIQETS_LANGS = new Set(['en', 'ko', 'ja', 'es', 'zh']);

/**
 * 도시가 표에 있으면 Tiqets 딥링크, 없으면 null.
 * @param {object} opts
 * @param {string} opts.city      글의 region (영문)
 * @param {string} [opts.country] 나라(영문). 주어지면 표의 나라와 같아야 한다 — 동명 도시 방어.
 * @param {string} opts.lang      사이트 언어 (en/ko/ja/es/zh)
 * @param {string} [opts.subId]   어느 버튼인지 (Travelpayouts 리포트에서 구분)
 */
export function tiqetsCityUrl({ city, country, lang, subId }) {
  const m = TIQETS_CITY[String(city ?? '').trim()];
  if (!m) return null;
  if (country && String(country).trim() !== m.country) return null;
  const l = TIQETS_LANGS.has(lang) ? lang : 'en';
  const to = `https://www.tiqets.com/${l}/${m.slug}/`;
  const sub = subId ? `&sub_id=${String(subId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)}` : '';
  return `https://tp.media/r?marker=754088&trs=553157&p=2074&campaign_id=89${sub}&u=${encodeURIComponent(to)}`;
}

/** 버튼 문구의 {brand} 자리 — 링크가 실제로 가는 곳의 이름. 한국어 Klook 은 원래 문구대로 "클룩". */
export function affiliateBrand(href, lang) {
  if (/tiqets\.com/.test(String(href ?? ''))) return 'Tiqets';
  return lang === 'ko' ? '클룩' : 'Klook';
}
