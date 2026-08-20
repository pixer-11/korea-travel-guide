// 발굴 시점 이벤트 중복 차단 회귀 테스트 (2026-08-20).
//
// 이 규칙이 없어서 재표현된 쌍둥이 5편(+몬자 1편)이 각각 작성+사진+비전+번역
// 4개까지 다 만들어진 뒤에야 게이트에 잡혔다. 여기서 재현하는 판정은
// discover-events.mjs writeDiscovered()의 것과 같은 수식 — 수식이 바뀌면
// 이 파일도 같이 바꿔야 한다(한쪽만 바꾸면 예방과 검증이 갈라진다).
//   node scripts/lib/event-dedupe.test.mjs
import { keyToken, tokens as nameTokens, ANCHOR_STOP } from './commons.mjs';
import { eventSchemaName } from '../../src/lib/eventName.mjs';

const mkExisting = ({ title, country, region, start, end }) => {
  const schemaName = eventSchemaName(title);
  return {
    country, region: String(region).toLowerCase(),
    anchor: keyToken(schemaName, `${region} ${country}`) || '',
    toks: new Set(nameTokens(schemaName).filter((t) => !ANCHOR_STOP.has(t) && !/^(19|20)\d{2}$/.test(t))),
    start: start || '', end: end || start || '',
  };
};

const isDup = (cand, existing) => {
  const schemaName = eventSchemaName(cand.title);
  const a = keyToken(schemaName, `${cand.city} ${cand.country}`) || '';
  const toks = new Set(nameTokens(schemaName).filter((t) => !ANCHOR_STOP.has(t) && !/^(19|20)\d{2}$/.test(t)));
  const s0 = cand.start || '';
  const e0 = cand.end || s0;
  const near = (x, y) => x && y && Math.abs(new Date(x) - new Date(y)) <= 3 * 864e5;
  const overlap = (ev) => {
    if (!s0 || !ev.start) return true;
    return near(s0, ev.start) || (s0 <= (ev.end || ev.start) && ev.start <= e0);
  };
  return existing.some((ev) => {
    if (ev.country !== cand.country || !overlap(ev)) return false;
    if (a && ev.anchor && a === ev.anchor) return true;
    const shared = [...toks].some((t) => ev.toks.has(t));
    if (shared) return ev.region === String(cand.city).toLowerCase();
    if ((!toks.size || !ev.toks.size) && ev.region === String(cand.city).toLowerCase()) return true;
    return false;
  });
};

// 08-20 실제 라이브 원본들
const LIVE = [
  mkExisting({ title: 'Christina Aguilera Live: What to Know (Abu Dhabi)', country: 'United Arab Emirates', region: 'Abu Dhabi', start: '2026-09-05' }),
  mkExisting({ title: 'BIGBANG 2026-2027 World Tour XX COSMOS Goyang Opening Shows: What to Know (Goyang)', country: 'South Korea', region: 'Goyang', start: '2026-10-10', end: '2026-10-11' }),
  mkExisting({ title: 'The Weeknd - After Hours Til Dawn/Hurry Up Tomorrow Tour: What to Know (Singapore)', country: 'Singapore', region: 'Singapore', start: '2026-10-02' }),
  mkExisting({ title: 'ITZY TUNNEL VISION World Tour – Taipei: What to Know (Taipei)', country: 'Taiwan', region: 'Taipei', start: '2026-09-12' }),
  mkExisting({ title: 'Venice International Film Festival (Mostra del Cinema): What to Know (Venice)', country: 'Italy', region: 'Venice', start: '2026-09-02', end: '2026-09-12' }),
  mkExisting({ title: 'Formula 1 Italian Grand Prix 2026: What to Know (Monza)', country: 'Italy', region: 'Monza', start: '2026-09-04', end: '2026-09-06' }),
];

const cases = [
  // 오늘 실제로 중복 생성된 6편 — 전부 차단돼야 한다
  ['Christina Aguilera Live in Abu Dhabi', { title: 'Christina Aguilera Live in Abu Dhabi: Dates, Tickets & Venue (Abu Dhabi)', city: 'Abu Dhabi', country: 'United Arab Emirates', start: '2026-09-05' }, true],
  ['BIGBANG 20/26 재표현', { title: 'BIGBANG 20/26 World Tour: Dates, Tickets & Venue (Goyang)', city: 'Goyang', country: 'South Korea', start: '2026-10-10' }, true],
  ['위켄드 싱가포르 재표현', { title: 'The Weeknd After Hours Til Dawn Tour: Dates, Tickets & Venue (Singapore)', city: 'Singapore', country: 'Singapore', start: '2026-10-02' }, true],
  ['ITZY 타이베이 재표현', { title: 'ITZY 3rd World Tour TUNNEL VISION: Dates, Tickets & Venue (Taipei)', city: 'Taipei', country: 'Taiwan', start: '2026-09-12' }, true],
  ['베니스 영화제 재표현', { title: 'Venice Film Festival (Mostra): Dates, Tickets & Venue (Venice)', city: 'Venice', country: 'Italy', start: '2026-09-02' }, true],
  ['몬자 F1 — 원본 제목이 전부 stop-word', { title: 'Italian Grand Prix (F1 Monza): Dates, Tickets & Venue (Monza)', city: 'Monza', country: 'Italy', start: '2026-09-04' }, true],

  // 오늘 정당하게 새로 만든 것들 — 통과해야 한다
  ['소누 니감 아부다비(같은 도시 다른 가수)', { title: 'Sonu Nigam 30 Years of Sonu Revolution Tour: Dates, Tickets & Venue (Abu Dhabi)', city: 'Abu Dhabi', country: 'United Arab Emirates', start: '2026-09-05' }, false],
  ['위켄드 사이타마(다른 나라)', { title: 'The Weeknd After Hours Til Dawn Tour: Dates, Tickets & Venue (Saitama)', city: 'Saitama', country: 'Japan', start: '2026-10-20' }, false],
  ['ITZY 싱가포르(다른 나라)', { title: 'ITZY 3rd World Tour TUNNEL VISION: Dates, Tickets & Venue (Singapore)', city: 'Singapore', country: 'Singapore', start: '2026-09-20' }, false],
  ['같은 나라 같은 앵커, 날짜가 멀면 다른 회차', { title: 'Christina Aguilera Live: Dates, Tickets & Venue (Dubai)', city: 'Dubai', country: 'United Arab Emirates', start: '2027-03-01' }, false],
  ['같은 도시 같은 날 다른 가수(토큰 서로소)', { title: 'Blackpink World Tour: Dates, Tickets & Venue (Goyang)', city: 'Goyang', country: 'South Korea', start: '2026-10-10' }, false],
];

let fail = 0;
for (const [name, cand, want] of cases) {
  const got = isDup(cand, LIVE);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — expected ${want}, got ${got}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
