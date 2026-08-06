// validate-content 회귀 테스트.
//
// 이 검사기는 사이트에서 가장 많이 돌아가는 검사기인데 테스트가 하나도 없었다.
// 여기서 오탐이 나면 멀쩡한 글이 조용히 문제로 보고되고, 미탐이 나면 결함이
// 그대로 발행된다 — 둘 다 실제로 겪었다. 그래서 규칙마다 "걸려야 하는 것(TP)"과
// "절대 걸리면 안 되는 것(FP)"을 쌍으로 고정한다.
//
//   node scripts/validate-content.test.mjs
import { postProblems, parsePost, photoVerificationProblems } from './validate-content.mjs';

// 아무 규칙에도 걸리지 않는 건강한 글. 모든 케이스는 여기서 한 필드만 바꾼다 —
// 그래야 실패했을 때 원인이 그 필드 하나로 좁혀진다.
const base = (over = {}) => ({
  f: 'test-post.md',
  region: 'Seoul',
  category: 'attraction',
  title: 'Bukchon Hanok Village: What to See in Seoul',
  url: 'https://images.unsplash.com/photo-1500000000000',
  credit: 'Photo by Someone',
  license: 'unsplash',
  placeId: 'ChIJ_test',
  placeName: 'Bukchon Hanok Village',
  country: 'South Korea',
  description: 'A hillside of tiled roofs between two palaces, best walked early.',
  quickAnswer: 'Go before 10am on a weekday.',
  eventStart: '',
  eventEnd: '',
  gallery: [],
  heroCredit: 'Photo by Someone',
  rating: 0,
  phone: '',
  busyness: null,
  openingHours: null,
  pubDate: '2026-08-01',
  updatedDate: '',
  body: 'The lanes are residential, so keep your voice down.',
  ...over,
});

const TODAY = '2026-08-04';   // 고정 — 달력이 흘러도 결과가 변하지 않도록
const run = (over, opts) => postProblems(base(over), { today: TODAY, ...opts });
const has = (out, tag) => out.some((i) => i.startsWith(tag));

const cases = [];
const clean = (name, over) => cases.push([name, () => {
  const out = run(over);
  return out.length === 0 ? null : `expected clean, got: ${out.join(' | ')}`;
}]);
const flags = (name, tag, over) => cases.push([name, () => {
  const out = run(over);
  return has(out, tag) ? null : `expected ${tag}, got: ${out.join(' | ') || '(clean)'}`;
}]);

// ── 기준: 건강한 글은 조용해야 한다 ──────────────────────────
clean('baseline post is clean', {});

// ── 잘린 description (2026-08-01에 825건 수리한 결함) ────────
clean('description ending in a quote is complete', { description: 'They call it "the quiet quarter."' });
clean('description with balanced parens', { description: 'Open early (before the tour buses).' });
flags('mid-clause description', 'TRUNCATED-DESCRIPTION', { description: 'A hillside of tiled roofs and best experienced' });
flags('unbalanced paren', 'TRUNCATED-DESCRIPTION', { description: 'Open early (before the tour buses.' });

// ── 도구 마크업 유출 (ipoh-han-chin-pet-soo 사고) ────────────
flags('closing tag in quickAnswer', 'TOOL-SPILL', { quickAnswer: 'Go early.</quickAnswer><parameter name="body">You almost walk past it' });
clean('an ordinary angle bracket is not a spill', { description: 'Rooms under 20 m2 feel snug.' });

// ── 제목 규칙 ────────────────────────────────────────────────
flags('Hangul leaked into the English H1', 'NON-LATIN', { title: '북촌한옥마을 Bukchon: Seoul' });
flags('city echoed in name AND suffix', 'CITY', { title: 'Seoul Tower: The Best Views in Seoul' });
clean('city only in the suffix half', { title: 'Namsan Tower: The Best Views in Seoul' });
clean('city repeated inside the raw place name only', { title: 'Gyukatsu Kyoto Katsugyu Kyoto: Where to Eat in Seoul' });
flags('dangling connector before colon', 'BROKEN TITLE', { title: 'Classical Gardens of: Suzhou Highlights' });
flags('filler subtitle regression', 'FILLER', { title: "Bukchon Hanok Village: A Visitor's Guide" });

// ── 장소 데이터 ──────────────────────────────────────────────
flags('search-query dump as place.name', 'GARBLED', { placeName: 'x / y restaurant / z vegan /' });
flags('missing country', 'MISSING-COUNTRY', { country: '' });
flags('national-format phone breaks tel: abroad', 'LOCAL-PHONE', { phone: '054-853-0109' });
clean('international phone', { phone: '+82 54-853-0109' });

// ── 본문 별점이 팩트박스와 어긋남 ────────────────────────────
flags('prose rating drifted from live rating', 'STALE-RATING', { rating: 4.2, body: 'It holds a 4.3 rating on Google.' });
clean('prose rating matches', { rating: 4.3, body: 'It holds a 4.3 rating on Google.' });
clean('a number that is not a rating', { rating: 4.3, body: 'The walk is 4.5 km end to end.' });

// ── 사진 ─────────────────────────────────────────────────────
flags('in-body photo is the hero', 'SAME-PHOTO-TWICE', { gallery: ['https://images.unsplash.com/photo-1500000000000'] });
flags('foursquare photo credits another business', 'PHOTO-WRONG-VENUE', {
  placeName: 'Dallas Pizza', credit: 'Foursquare', heroCredit: 'Foursquare (California Pizza Kitchen)',
});
clean('same venue, different spelling', {
  placeName: 'Sansan Bistro', credit: 'Foursquare', heroCredit: 'Foursquare (Sansan)',
});
clean('generic business word alone is not a match', {
  placeName: 'Bukchon Hanok Village', credit: 'Foursquare', heroCredit: 'Foursquare (Bukchon Hanok Village Cafe)',
});
flags('placeholder image', 'PLACEHOLDER', { url: '/images/placeholder-market.svg' });

// ── 종료된 행사가 아직 미래형으로 말하는 경우 ────────────────
flags('ended event still promising tickets', 'ENDED-EVENT-FUTURE-TENSE', {
  category: 'event', eventStart: '2026-07-01', eventEnd: '2026-07-03',
  body: 'Tickets go on sale in March through the official site.',
});
clean('ended event with only descriptive future', {
  category: 'event', eventStart: '2026-07-01', eventEnd: '2026-07-03',
  body: 'Street circuits mean the cars will run through the city centre.',
});
clean('FUTURE event may promise anything', {
  category: 'event', eventStart: '2026-09-01', eventEnd: '2026-09-03',
  body: 'The full lineup will be announced in August.',
});
// 따옴표 없는 YAML 날짜는 Date 객체로 들어온다. 문자열과 Date를 그냥 비교하면
// 항상 false가 되어 이 규칙이 통째로 잠들어 있었다 — 두 표기 모두 같아야 한다.
flags('ended event whose date arrived as a Date object', 'ENDED-EVENT-FUTURE-TENSE', {
  category: 'event', eventStart: '2026-07-01', eventEnd: new Date('2026-07-03T00:00:00Z'),
  body: 'Tickets go on sale in March through the official site.',
});
flags('event with no start date', 'EVENT missing', { category: 'event', eventStart: '', eventEnd: '' });

// ── 낡은 가격 주장 ───────────────────────────────────────────
clean('a fresh price claim is fine', { pubDate: '2026-06-01', body: 'A plate runs about 80 baht.' });
flags('a price claim older than a year', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'A plate runs about 80 baht.' });
flags('an aged free-entry promise', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'Entry is free, so just walk in.' });
clean('an updatedDate resets the clock', { pubDate: '2025-01-01', updatedDate: '2026-07-20', body: 'A plate runs about 80 baht.' });
clean('a number that is not money', { pubDate: '2024-01-01', body: 'The hall seats 500 and opens at 9.' });
// 통화가 빠져 있으면 그 나라 글은 낡음 검사 자체가 걸리지 않는다 — 검사기가
// 조용한 것과 콘텐츠가 깨끗한 것을 구별할 수 없게 된다.
flags('an aged dirham price', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'Entry runs AED 50 per adult.' });
flags('an aged rupee price', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'Tickets are ₹200 at the gate.' });
flags('an aged yuan price', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'A bowl costs 元35 near the station.' });
flags('an aged lira price', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'Admission is ₺150.' });
flags('an aged ISO-coded price written after the number', 'STALE-PRICE-CLAIM', { pubDate: '2025-01-01', body: 'Expect 300 THB for the set menu.' });
// "TRY" 는 영어 동사이기도 하다. 대소문자를 구분하지 않으면 모든 맛집 글이 걸린다.
clean('the verb "try" before a number is not a price', { pubDate: '2024-01-01', body: 'Try 2 dishes and share them.' });

// ── 낡은 "새로 문 열었다" 주장 ───────────────────────────────
clean('a fresh newness claim is fine', { pubDate: '2026-06-01', body: 'This newly opened cafe sits by the river.' });
flags('a newness claim older than a year', 'STALE-NEW-CLAIM', { pubDate: '2025-01-01', body: 'This newly opened cafe sits by the river.' });
flags('an aged "opened in 2024"', 'STALE-NEW-CLAIM', { pubDate: '2025-01-01', body: 'The museum opened in 2024 on the waterfront.' });
flags('an aged "brand-new"', 'STALE-NEW-CLAIM', { pubDate: '2025-01-01', body: 'A brand-new rooftop bar tops the tower.' });
// 갱신은 구글 필드만 다시 읽을 뿐 문장을 다시 읽지 않는다 — 시계를 되돌리면
// 주장이 영원히 살아남는다.
flags('an updatedDate does NOT reset the newness clock', 'STALE-NEW-CLAIM', { pubDate: '2025-01-01', updatedDate: '2026-07-20', body: 'This newly opened cafe sits by the river.' });
clean('an old post that claims nothing about newness', { pubDate: '2024-01-01', body: 'The market has traded here for decades.' });

// ── region 슬래시 (라우트를 깨뜨림) ──────────────────────────
flags('slash in region', 'SLASH', { region: 'Seoul/Gyeonggi' });

// ── 사진 판정과 공개 상태의 어긋남 ───────────────────────────
{
  const SEP = String.fromCharCode(1);
  const post = (over) => base({ f: 'cafe.md', category: 'trendy', url: 'https://x/p.jpg', ...over });
  const key = `cafe${SEP}https://x/p.jpg`;

  cases.push(['MISMATCH 판정인데 공개 중이면 잡는다', () => {
    const out = photoVerificationProblems([post()], { [key]: { verdict: 'MISMATCH', at: '2026-08-03T12:46:00Z', reasonKo: '뷰티 제품 진열' } }, { today: TODAY });
    return has(out, 'UNQUARANTINED-MISMATCH') ? null : `놓침: ${out.join(' | ') || '(clean)'}`;
  }]);
  cases.push(['MATCH 판정이면 조용하다', () => {
    const out = photoVerificationProblems([post()], { [key]: { verdict: 'MATCH', at: '2026-08-03T12:46:00Z' } }, { today: TODAY });
    return out.length === 0 ? null : `오탐: ${out.join(' | ')}`;
  }]);
  cases.push(['갓 발행된 글은 미판정이어도 조용하다', () => {
    const out = photoVerificationProblems([post({ pubDate: '2026-08-03' })], {}, { today: TODAY });
    return out.length === 0 ? null : `오탐: ${out.join(' | ')}`;
  }]);
  cases.push(['며칠 지나도 미판정이면 잡는다', () => {
    const out = photoVerificationProblems([post({ pubDate: '2026-07-24' })], {}, { today: TODAY });
    return has(out, 'UNVERIFIED-PHOTO') ? null : `놓침: ${out.join(' | ') || '(clean)'}`;
  }]);
  cases.push(['장소형이 아닌 글은 사진검증 대상이 아니다', () => {
    const out = photoVerificationProblems([post({ category: 'event', pubDate: '2026-07-01' })], {}, { today: TODAY });
    return out.length === 0 ? null : `오탐: ${out.join(' | ')}`;
  }]);
  cases.push(['미판정이 많으면 총계도 함께 보고한다', () => {
    const many = Array.from({ length: 9 }, (_, i) => post({ f: `c${i}.md`, url: `https://x/${i}.jpg`, pubDate: '2026-07-01' }));
    const out = photoVerificationProblems(many, {}, { today: TODAY });
    return out.some((i) => i.includes('9건')) ? null : `총계 누락: ${out.join(' | ')}`;
  }]);
}

// ── parsePost: 프론트매터 읽기 ───────────────────────────────
cases.push(['parsePost skips drafts', () => {
  const raw = '---\ntitle: T\ndraft: true\ncountry: South Korea\n---\nbody';
  return parsePost('x.md', raw) === null ? null : 'draft post should not be returned';
}]);
cases.push(['parsePost reads an unquoted date without slipping to 2001', () => {
  const raw = '---\ntitle: T\ncountry: South Korea\npubDate: 2026-07-21\n---\nbody';
  const p = parsePost('x.md', raw);
  return p && p.pubDate === '2026-07-21' ? null : `pubDate read as "${p && p.pubDate}"`;
}]);
cases.push(['parsePost survives broken YAML instead of throwing', () => {
  const raw = '---\ntitle: "unclosed\n---\nbody';
  return parsePost('x.md', raw) === null ? null : 'broken frontmatter should yield null';
}]);

// ── 여러 날 행사가 하루로 저장된 경우 ────────────────────────
// US Open 이 "8월 23일–9월 13일"이라 써놓고 하루짜리로 저장돼, 구독 캘린더에
// 마지막 날만 들어갔다. 구독자는 대회 전체를 놓친다(2026-08-06).
const ev = (over) => base({ category: 'event', eventStart: '2026-09-13', eventEnd: '2026-09-13', ...over });
cases.push(['범위를 말하는데 하루로 저장되면 잡는다', () => {
  const out = run({ ...ev({ quickAnswer: 'The 2026 US Open runs August 23–September 13 at the USTA center.' }) });
  return has(out, 'EVENT-SINGLE-DAY-RANGE') ? null : `놓침: ${out.join(' | ') || '(clean)'}`;
}]);
cases.push(['같은 달 범위도 잡는다', () => {
  const out = run({ ...ev({ eventStart: '2026-08-02', eventEnd: '2026-08-02', quickAnswer: 'The festival runs August 1–2 in Songdo.' }) });
  return has(out, 'EVENT-SINGLE-DAY-RANGE') ? null : `놓침: ${out.join(' | ') || '(clean)'}`;
}]);
cases.push(['진짜 하루짜리 행사는 조용하다', () => {
  const out = run({ ...ev({ quickAnswer: 'The concert takes place on September 13 at the arena.' }) });
  return out.some((i) => i.startsWith('EVENT-SINGLE-DAY-RANGE')) ? `오탐: ${out.join(' | ')}` : null;
}]);
cases.push(['시작·종료가 다르면 검사하지 않는다', () => {
  const out = run({ ...ev({ eventStart: '2026-08-23', eventEnd: '2026-09-13', quickAnswer: 'runs August 23–September 13' }) });
  return out.some((i) => i.startsWith('EVENT-SINGLE-DAY-RANGE')) ? `오탐: ${out.join(' | ')}` : null;
}]);

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
