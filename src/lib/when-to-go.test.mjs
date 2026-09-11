// monthComfort 회귀 테스트.
//
// 이 함수의 첫 판은 절대 기준(18~28°C, 낮은 강수)으로 점수를 매겼고 열대에서
// 무너졌다 — 방콕·시엠립은 열두 달 내내 32°C 위라 **모두가 여행하는 건기까지**
// 우기와 함께 "피함"으로 나왔다. 그래서 각 달을 **그 나라 자기 열두 달 안에서**
// 평가한다. 아래 테스트는 그 두 기후대가 동시에 말이 되는지를 지킨다.
//   node --test src/lib/when-to-go.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthComfort, bestMonth } from './when-to-go.mjs';

const FACTS = JSON.parse(readFileSync('data/country-facts.json', 'utf8'));
const countries = FACTS.countries ?? FACTS;
const climateOf = (name) => countries[name]?.climate;
const bandOf = (name) => {
  const c = monthComfort(climateOf(name));
  return Object.fromEntries(c.map((x) => [x.m, x.band]));
};
const ok = (b) => b === 'good' || b === 'fine';
const bad = (b) => b === 'fair' || b === 'harsh';

test('열두 달이 아니면 판정하지 않는다', () => {
  assert.equal(monthComfort(null), null);
  assert.equal(monthComfort([{ m: 1, hi: 20, rain: 10 }]), null);
  assert.equal(bestMonth([]), null);
});

test('온대: 한국은 봄·가을이 좋고 장마철이 나쁘다', () => {
  const b = bandOf('South Korea');
  assert.ok(ok(b[4]) && ok(b[5]), `4·5월이 좋아야 한다: ${b[4]}/${b[5]}`);
  assert.ok(ok(b[10]), `10월이 좋아야 한다: ${b[10]}`);
  assert.ok(bad(b[7]) && bad(b[8]), `장마·폭염기는 나빠야 한다: ${b[7]}/${b[8]}`);
});

test('열대: 건기가 좋게 나와야 한다 — 절대 기준이 무너졌던 자리', () => {
  for (const name of ['Thailand', 'Cambodia', 'Vietnam']) {
    const b = bandOf(name);
    const dry = [11, 12, 1].filter((m) => ok(b[m])).length;
    assert.ok(dry >= 2, `${name}: 11·12·1월 중 둘 이상이 좋아야 한다 (${dry})`);
  }
});

test('열대: 우기는 나쁘게 나와야 한다', () => {
  const hk = bandOf('Hong Kong');
  assert.ok([6, 7, 8].every((m) => bad(hk[m])), '홍콩의 한여름은 나빠야 한다');
  const tw = bandOf('Taiwan');
  assert.ok(bad(tw[6]) || bad(tw[7]), '대만의 초여름은 나빠야 한다');
});

test('모든 나라가 열두 달을 받고, 최적 달이 하나 나온다', () => {
  let n = 0;
  for (const [name, c] of Object.entries(countries)) {
    if (!Array.isArray(c.climate) || c.climate.length !== 12) continue;
    n++;
    const mc = monthComfort(c.climate);
    assert.equal(mc.length, 12, `${name}: 열두 달이어야 한다`);
    assert.deepEqual(mc.map((x) => x.m), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `${name}: 달 순서`);
    const best = bestMonth(c.climate);
    assert.ok(best && best.m >= 1 && best.m <= 12, `${name}: 최적 달`);
    // 근거가 화면에 같이 나가므로 값이 비어 있으면 안 된다.
    for (const x of mc) assert.equal(typeof x.hi, 'number', `${name} ${x.m}월: 기온`);
  }
  // 빈 저장소로 통과하지 않는다 — 이 파일이 판정한 나라가 실제로 있어야 한다.
  assert.ok(n >= 15, `기후 기록을 가진 나라가 ${n}개뿐이다 — country-facts.json 을 확인할 것`);
});

test('일 년 내내 같은 나라는 가운데로 모인다 (싱가포르)', () => {
  const b = bandOf('Singapore');
  const extreme = Object.values(b).filter((x) => x === 'harsh').length;
  assert.ok(extreme <= 2, `변화가 거의 없는 나라에 "피함"이 ${extreme}개나 나왔다`);
});
