// ─────────────────────────────────────────────────────────────
//  "할 거리·입장권" 버튼 — 유럽·미국·중동 도시는 Tiqets 로 보낸다.
//
//  2026-10-01 픽서님 대시보드 확인: GetYourGuide·Viator(8%)는 "3개월 연속
//  트래픽" 심사에 잠겨 있고, 같은 계정에서 **Tiqets(3.5–8%, 쿠키 30일)는
//  연결돼 있다**. Klook(2–5%)은 아시아에 강하고 유럽·미국 상품은 얇다 →
//  이 지역은 Tiqets 가 같은 클릭에 더 많이 번다. 아시아는 Klook 그대로.
//  호주(10-04, 픽서님 "순서대로 다 처리해")는 Tiqets 상품이 충분한 4개 도시만
//  (도시 페이지의 장소 수: 시드니 25 · 케언스 20 · 멜버른 14 · 골드코스트 10).
//  브리즈번 1 · 퍼스·애들레이드·호바트·다윈·앨리스스프링스 0 → Klook 그대로.
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
  // Australia — pages checked for their own sights (Opera House, Sea World,
  // Kuranda, Great Ocean Road), so not Perth, Scotland and the like
  "Cairns": { id: 60466, slug: "cairns-attractions-c60466", country: "Australia" },
  "Gold Coast": { id: 60442, slug: "gold-coast-attractions-c60442", country: "Australia" },
  "Melbourne": { id: 60426, slug: "melbourne-attractions-c60426", country: "Australia" },
  "Sydney": { id: 60400, slug: "sydney-attractions-c60400", country: "Australia" },
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


// ─────────────────────────────────────────────────────────────
//  명소 글의 "입장권" 버튼 → 그 명소의 Tiqets 상품 페이지 (2026-10-04).
//  그 전엔 콜로세움 글도 "로마 전체" 페이지로 갔다(코덱스 수익화 검토).
//
//  추측이 아니다: Tiqets 장소 사이트맵(site-map-location-en, 7,707곳)과 글의
//  place.name 을 정확히 맞추고, 티켓 페이지(-tickets-l…)만, 페이지 제목의
//  도시가 글의 도시와 같은 것만 남겼다. 빠진 것: 말라가 "Alcazaba"(그라나다
//  알카사바 페이지), 맨체스터 "Alexandra Park"(런던), Oak Alley(Vacherie),
//  로마 "Pantheon"(파리 팡테옹 페이지). 무료 장소(로열 마일·술탄아흐메트
//  광장·그랜드 바자르·트레비 분수·대운하·보르게세 공원·리딩 터미널 마켓)는
//  유료 상품을 붙이지 않는다 — 도시 페이지 그대로. 입장이 무료인 곳도 같다(코덱스
//  10-04): 대영박물관·그리피스 천문대·노트르담은 유료 투어만 파는 페이지라 뺐다. 언어 주소는 /en/ 을
//  바꿔도 Tiqets 가 그 언어로 보낸다(es 는 entradas-coliseo-de-roma 로 리다이렉트).
//  키 = 글 id. 새 명소 글은 같은 방식으로 한 줄씩.
// ─────────────────────────────────────────────────────────────
export const TIQETS_VENUE = {
  "abu-dhabi-louvre-abu-dhabi": "louvre-abu-dhabi-tickets-l146406", // Abu Dhabi — Louvre Abu Dhabi
  "abu-dhabi-qasr-al-hosn": "qasr-al-hosn-tickets-l163762", // Abu Dhabi — Qasr Al Hosn
  "austin-neill-cochran-house-museum": "neill-cochran-house-museum-tickets-l192778", // Austin — Neill-Cochran House Museum
  "barcelona-casa-batllo": "casa-batllo-tickets-l141895", // Barcelona — Casa Batlló
  "barcelona-mirador-torre-glories": "mirador-torre-glories-tickets-l192949", // Barcelona — Mirador Torre Glòries
  "barcelona-museu-nacional-d-art-de-catalunya": "museu-nacional-dart-de-catalunya-tickets-l146144", // Barcelona — Museu Nacional d'Art de Catalunya
  "barcelona-park-guell": "park-guell-tickets-l141902", // Barcelona — Park Güell
  "belfast-titanic-belfast": "titanic-belfast-tickets-l145901", // Belfast — Titanic Belfast
  "boston-the-paul-revere-house": "paul-revere-house-tickets-l242969", // Boston — The Paul Revere House
  "brighton-brighton-i360": "brighton-i360-tickets-l151387", // Brighton — Brighton i360
  // Australia (10-04): Darling Harbour (free waterfront) and the National
  // Gallery of Victoria (free general entry) keep the city page.
  "cairns-cairns-aquarium": "cairns-aquarium-tickets-l159870", // Cairns — Cairns Aquarium
  "melbourne-melbourne-museum": "melbourne-museum-tickets-l230095", // Melbourne — Melbourne Museum
  "melbourne-melbourne-skydeck": "melbourne-skydeck-tickets-l147381", // Melbourne — Melbourne Skydeck
  "cordoba-alcazar-de-los-reyes-cristianos": "alcazar-de-los-reyes-cristianos-tickets-l146379", // Cordoba — Alcázar de los Reyes Cristianos
  "florence-boboli-gardens": "boboli-gardens-tickets-l144784", // Florence — Boboli Gardens
  "florence-palazzo-vecchio": "palazzo-vecchio-tickets-l145924", // Florence — Palazzo Vecchio
  "granada-alhambra": "alhambra-tickets-l145851", // Granada — Alhambra
  "las-vegas-springs-preserve": "springs-preserve-tickets-l146463", // Las Vegas — Springs Preserve
  "las-vegas-the-mob-museum": "the-mob-museum-tickets-l146070", // Las Vegas — The Mob Museum
  "london-london-eye": "london-eye-tickets-l133176", // London — London Eye
  "madrid-royal-palace-of-madrid": "royal-palace-of-madrid-tickets-l454", // Madrid — Royal Palace of Madrid
  "malaga-museo-carmen-thyssen-malaga": "museo-carmen-thyssen-malaga-tickets-l145949", // Malaga — Museo Carmen Thyssen Málaga
  "milan-duomo-di-milano": "duomo-di-milano-tickets-l145637", // Milan — Duomo di Milano
  "milan-pinacoteca-di-brera": "pinacoteca-di-brera-tickets-l240644", // Milan — Pinacoteca di Brera
  "naples-catacombs-of-san-gennaro": "catacombs-of-san-gennaro-tickets-l146325", // Naples — Catacombs of San Gennaro
  "nashville-cheekwood": "cheekwood-tickets-l243782", // Nashville — Cheekwood
  "new-orleans-the-national-wwii-museum": "the-national-wwii-museum-tickets-l147305", // New Orleans — The National WWII Museum
  "new-york-one-world-observatory": "one-world-observatory-tickets-l145522", // New York — One World Observatory
  "new-york-statue-of-liberty": "statue-of-liberty-tickets-l145521", // New York — Statue of Liberty
  "new-york-the-metropolitan-museum-of-art": "the-metropolitan-museum-of-art-tickets-l145523", // New York — The Metropolitan Museum of Art
  "paris-arc-de-triomphe": "arc-de-triomphe-tickets-l141732", // Paris — Arc de Triomphe
  "paris-eiffel-tower": "eiffel-tower-tickets-l144586", // Paris — Eiffel Tower
  "paris-louvre-museum": "louvre-museum-tickets-l124297", // Paris — Louvre Museum
  "paris-musee-de-l-orangerie": "musee-de-lorangerie-tickets-l145770", // Paris — Musée de l'Orangerie
  "paris-palace-of-versailles": "palace-of-versailles-tickets-l141873", // Paris — Palace of Versailles
  "paris-pantheon": "pantheon-tickets-l145950", // Paris — Panthéon
  "paris-sainte-chapelle": "sainte-chapelle-tickets-l145802", // Paris — Sainte-Chapelle
  "rome-colosseum": "colosseum-tickets-l145769", // Rome — Colosseum
  "rome-roman-forum": "roman-forum-tickets-l146049", // Rome — Roman Forum
  "seville-la-giralda": "la-giralda-tickets-l245951", // Seville — La Giralda
  "seville-palacio-de-las-duenas": "palacio-de-las-duenas-tickets-l151950", // Seville — Palacio de las Dueñas
  "seville-royal-alcazar-of-seville": "royal-alcazar-of-seville-tickets-l146992", // Seville — Royal Alcázar of Seville
  "siena-santa-maria-della-scala": "santa-maria-della-scala-tickets-l146940", // Siena — Santa Maria della Scala
  "toledo-alcazar-de-toledo": "alcazar-de-toledo-tickets-l147761", // Toledo — Alcázar de Toledo
  "valencia-ciudad-de-las-artes-y-las-ciencias": "ciudad-de-las-artes-y-las-ciencias-tickets-l146904", // Valencia — Ciudad de las Artes y las Ciencias
  "verona-castelvecchio-museum": "castelvecchio-museum-tickets-l251581", // Verona — Castelvecchio Museum
  "york-york-minster": "york-minster-tickets-l147676", // York — York Minster
};

/** 그 글의 명소 상품 페이지 딥링크, 없으면 null(부르는 쪽이 도시 페이지로). */
export function tiqetsVenueUrl({ postId, lang, subId }) {
  const slug = TIQETS_VENUE[String(postId ?? '')];
  if (!slug) return null;
  const l = TIQETS_LANGS.has(lang) ? lang : 'en';
  const to = `https://www.tiqets.com/${l}/${slug}/`;
  const sub = subId ? `&sub_id=${String(subId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)}` : '';
  return `https://tp.media/r?marker=754088&trs=553157&p=2074&campaign_id=89${sub}&u=${encodeURIComponent(to)}`;
}
