// fix-ended-event-tense 회귀 테스트 — "예측을 결과로 바꾸지 않는다".
//
// 2026-09-02 밤, 시제 수리 도구가 끝난 이벤트 41편의 미래 약속을 지우면서
// 예정·안내였던 문장을 "실제로 일어난 일"로 바꿔 썼다. 걸프 전역에서 팬이
// 날아왔고, 셔틀이 달렸고, 특별열차가 운행됐고, 펠로톤이 파리로 굴러들어갔다
// — 아무도 확인한 적 없는 것들이다. 도구의 가드는 길이·제목·약속 정규식만
// 봤고 "결과 주장"은 볼 줄 몰랐다. 이 테스트는 그 가드(inventedOutcomes)가
// 원문에 없던 결과를 잡고, 원문이 이미 말한 사실과 중립 표현은 놓아주는지
// 양방향으로 확인한다.
//
//   node scripts/fix-ended-event-tense.test.mjs
import { inventedOutcomes, OUTCOME_VERB } from './lib/invented-outcomes.mjs';

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

// 09-02 실제 사례 — 전부 잡혀야 한다.
const invented = [
  ['abu-dhabi-sonu-nigam',
    "For the region's large South Asian diaspora, this is a big deal. Expect fans to fly in from across the Gulf, not just locals.",
    "For the region's large South Asian diaspora, that was a big deal. Fans flew in from across the Gulf, not just locals."],
  ['bangkok-f4 shuttle',
    'The easiest approach is the free IMPACT shuttle bus, which runs from Mo Chit BTS station direct to the venue on event days.',
    'The most common approach was the free IMPACT shuttle bus, which ran from Mo Chit BTS station direct to the venue on event days — this was the option most concertgoers used.'],
  ['east-rutherford-bruno-mars trains',
    "NJ Transit's dedicated Meadowlands Rail Line runs special event trains from New York Penn Station.",
    "NJ Transit's dedicated Meadowlands Rail Line, which ran special event trains from New York Penn Station."],
  ['foxborough-bts four states',
    'Expect BTS to draw fans from four states.',
    'BTS played Gillette Stadium, drawing fans from four states. Merchandise lines sold out early.'],
  ['george-town festival after dark',
    'Early evening is calmer; expect the crush to build after dark as multiple shows let out.',
    'Early evening was generally calmer; the crush built after dark as multiple shows let out.'],
  ['incheon-one-universe stages',
    'Expect the festival to offer a mix of open-air stages and indoor areas.',
    'The festival offered a mix of open-air stages and indoor/covered areas.'],
  ['singapore-mamamoo pickup zones',
    'Expect designated pickup/drop-off zones around the Sports Hub.',
    'Designated pickup/drop-off zones around the Sports Hub applied, since roads are often restricted.'],
  ['tokyo-formula-e programming',
    'Expect the Tokyo edition to lean into local flavor — food vendors and tech exhibitors.',
    'The Tokyo edition leaned into local flavor — food vendors, tech and mobility exhibitors.'],
  ['paris-tour-de-france peloton',
    'The peloton will roll into Paris on July 26 for the closing sprint.',
    'The peloton rolled into Paris on July 26 for the closing sprint.'],
  ['dubai-def-leppard took place',
    'The show is on August 2, 2026, at Coca-Cola Arena.',
    'The show took place on August 2, 2026, at Coca-Cola Arena.'],
];
for (const [name, before, after] of invented) {
  t(`잡는다: ${name}`, () => {
    const hits = inventedOutcomes(before, after);
    return hits.length ? null : `원문에 없던 결과를 놓침: "${after}"`;
  });
}

// 중립 표현 — 놓아줘야 한다.
const neutral = [
  ['was scheduled to run',
    'The free IMPACT shuttle runs from Mo Chit BTS station on event days.',
    'The free IMPACT shuttle was scheduled to run from Mo Chit BTS station on event days.'],
  ['organisers planned / was announced as',
    'Expect the festival to offer a mix of open-air stages.',
    'Organisers planned a mix of open-air stages; the published plan was announced as indoor and outdoor.'],
  ['deleted sentence',
    'The show is on August 2. Expect fans to fly in from across the Gulf.',
    'The show was on August 2.'],
  ['plain tense shift of a stated fact',
    'Doors open at 6pm and the venue is in Pasay.',
    'Doors opened at 6pm and the venue is in Pasay.'],
];
for (const [name, before, after] of neutral) {
  t(`놓아준다: ${name}`, () => {
    const hits = inventedOutcomes(before, after);
    return hits.length ? `중립 표현을 결과로 오인: ${JSON.stringify(hits)}` : null;
  });
}

// 원문이 이미 결과로 말한 것은 결과가 아니다 (역방향 가드).
t('원문에 이미 있는 "sold out"은 통과', () => {
  const before = 'The 2025 edition sold out in two days; tickets go on sale in June.';
  const after = 'The 2025 edition sold out in two days.';
  const hits = inventedOutcomes(before, after);
  return hits.length ? `원문의 사실을 기각: ${JSON.stringify(hits)}` : null;
});

t('원문의 "ran"은 통과시키되 새로 등장한 "took place"는 잡는다', () => {
  const before = 'Last year the race ran on a Sunday.';
  const after = 'Last year the race ran on a Sunday. The 2026 race took place on Saturday.';
  const hits = inventedOutcomes(before, after);
  if (hits.length !== 1) return `1건이어야 하는데 ${hits.length}건: ${JSON.stringify(hits)}`;
  return hits[0].verb === 'took place' ? null : `잘못된 동사: ${hits[0].verb}`;
});

t('보고에는 문장과 동사가 함께 온다', () => {
  const [hit] = inventedOutcomes('Fans will fly in.', 'Fans flew in from across the Gulf.');
  if (!hit) return '잡지 못함';
  if (!/flew in/i.test(hit.verb)) return `동사 누락: ${hit.verb}`;
  return /Gulf/.test(hit.sentence) ? null : `문장 누락: ${hit.sentence}`;
});

t('OUTCOME_VERB 는 단어 경계를 지킨다 ("Iran", "granted" 는 ran 이 아니다)', () => {
  const hits = inventedOutcomes('x', 'Fans from Iran were granted entry.');
  return hits.length ? `오탐: ${JSON.stringify(hits)}` : null;
});

t('OUTCOME_VERB 는 전역 플래그라 matchAll 에 쓸 수 있다', () =>
  OUTCOME_VERB.global ? null : 'g 플래그 없음');

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
