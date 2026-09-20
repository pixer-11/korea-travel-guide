import test from 'node:test';
import assert from 'node:assert/strict';
import { firstTell, countTells, tellSpans, TELLS } from './ai-tells.mjs';

test('깨끗한 원고는 통과시킨다', () => {
  const clean = 'The shrine sits on Museum Drive. Arrive before ten and the courtyard is quiet; by noon the tour buses are in.';
  assert.equal(firstTell(clean), null);
  assert.deepEqual(countTells(clean), {});
});

test('09-08 이후 실제로 새어 나온 문구 세 가지를 잡는다', () => {
  // 2026-09-19 기준 최근 유출 9건의 정체
  assert.equal(firstTell("Whether you're here for the carvings or the quiet, come early."), "Whether you're here for the carvings or");
  assert.ok(firstTell("This isn't just a temple, it's a working monastery."));
  assert.ok(firstTell('The iconic tower dominates the skyline.'));
});

test('문장 맨 앞의 문구를 돌려준다 — 재작성 요청이 무엇을 지울지 말해야 한다', () => {
  const body = 'A hidden gem in the heart of the old town.';
  assert.equal(firstTell(body), 'A hidden gem'.slice(2)); // 'hidden gem' 이 더 앞에 있다
});

test('평범한 영어는 건드리지 않는다', () => {
  assert.equal(firstTell('The heart of the fruit is bitter; locals scoop it out.'), null);
  assert.equal(firstTell('You must visit the office before 5pm to collect the permit.'), null);
});

test('countTells 는 갯수를 센다', () => {
  const body = 'An iconic view. Another iconic shot. A hidden gem too.';
  assert.deepEqual(countTells(body), { iconic: 2, 'hidden gem': 1 });
});

test('must-visit 은 과장 용법만 잡고 평범한 조동사는 놔둔다 (양방향)', () => {
  assert.ok(firstTell('Ayutthaya is a must-visit day trip from Bangkok.'));
  assert.ok(firstTell('The night market is a must see.'));
  assert.equal(firstTell('You must visit the ticket office before 5pm.'), null);
  assert.equal(firstTell('Visitors must see the permit desk first.'), null);
});

// TELLS 의 모든 항목에 문장을 하나씩. 새 항목을 넣고 여기를 안 채우면 아래
// 테스트가 이름을 대며 실패한다 — 어휘 목록이 조용히 늘어나는 것을 막는다.
const SAMPLES = {
  'in the heart of': 'The market sits in the heart of the old town.',
  "isn't just…it's": "It isn't just a museum, it's a whole afternoon.",
  'must-visit/see': 'A must-visit temple on the hill.',
  'whether you…or': "Whether you're walking or cycling, the path works.",
  iconic: 'The iconic bridge is floodlit at night.',
  'hidden gem': 'A hidden gem behind the station.',
  'not just…but': 'Not just a cafe but a bookshop too.',
  bustling: 'A bustling lane of noodle stalls.',
  nestled: 'The shrine is nestled between two hills.',
  unwind: 'A quiet bench to unwind on.',
  vibrant: 'A vibrant street of painted houses.',
  tapestry: 'A tapestry of neighbourhoods.',
  'testament to': 'The wall is a testament to the siege.',
  delve: 'Delve into the archive on the second floor.',
  'a myriad of': 'A myriad of stalls line the river.',
  plethora: 'A plethora of dumpling shops.',
  breathtaking: 'The view is breathtaking at dusk.',
  'immerse yourself': 'Immerse yourself in the tea ceremony.',
  'when it comes to': 'When it comes to opening hours, arrive early.',
  'in conclusion': 'In conclusion, go on a weekday.',
  "it's worth noting": "It's worth noting the lift closes at six.",
  'rich history/culture': 'The quarter has a rich history of printing.',
  'foodie paradise': 'The night market is a foodie paradise.',
};

// ── tellSpans: 주간 수리 큐에 넣을 수 있는 모양인가 (2026-09-20) ──
test('tellSpans 가 돌려주는 quote 는 본문에 그대로 있다 — repair-prose 는 못 찾으면 건너뛴다', () => {
  const body = "Seoul is a hidden gem in the heart of Asia. It isn't just a city, it's a must-visit stop.";
  const spans = tellSpans(body);
  assert.ok(spans.length >= 3, `찾은 것이 너무 적다: ${JSON.stringify(spans)}`);
  for (const s of spans) {
    assert.equal(s.type, 'ai-tell');
    assert.ok(body.includes(s.quote), `본문에 없는 quote: ${s.quote}`);
    assert.ok(s.tell, 'tell 이름이 비어 있다');
  }
});

test('같은 표현이 여러 번 나와도 한 줄로 합친다 — 같은 수리를 두 번 시키지 않는다', () => {
  const spans = tellSpans('A hidden gem here, and another hidden gem there.');
  assert.equal(spans.filter((s) => s.tell === 'hidden gem').length, 1);
});

test('멀쩡한 글은 아무것도 만들지 않는다 (빈 줄이 큐에 쌓이면 안 된다)', () => {
  assert.deepEqual(tellSpans('A quiet lane behind the market, busiest just after six.'), []);
  assert.deepEqual(tellSpans(''), []);
  assert.deepEqual(tellSpans(null), []);
});

test('🛑 TELLS 의 모든 항목이 tellSpans 로도 잡힌다 — 두 경로가 갈라지면 안 된다', () => {
  for (const [name, re] of Object.entries(TELLS)) {
    const sample = SAMPLES[name];
    assert.ok(sample, `${name} 에 샘플 문장이 없다 — 새 항목을 넣었으면 SAMPLES 에도 넣을 것`);
    assert.ok(re.test(sample) || new RegExp(re.source, 'i').test(sample), `${name} 정규식이 자기 샘플을 못 잡는다`);
    assert.ok(tellSpans(sample).some((s) => s.tell === name), `${name} 이 tellSpans 에서 빠진다`);
  }
});
