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

// ── 사막·건조 기후 (2026-10-05) ──────────────────────────────────────────────
// 두바이는 일 년 강수가 1~25mm 사이인데, 0..1 로 늘리자 그 24mm 차이가 답을 정했다.
// 그래서 9월(38°C, 1mm)이 UAE에서 세 번째로 "쉬운 달"로, 우즈베키스탄은 8월(37°C)이
// 목록에 올랐다. 큐레이션된 essentials-facts 의 UAE 성수기는 11~3월이다.
// 아래는 그 두 가드(강수 폭 바닥·32°C 초과 열 벌점)를 지키고, 고친 범위가 사막
// 밖으로 번지지 않았는지를 거꾸로도 잰다.
import { bestMonths } from './dest-hub.mjs';

const ranked = (name) => [...monthComfort(climateOf(name))].sort((a, b) => a.score - b.score);
const UAE_SEASON = [11, 12, 1, 2, 3];

test('사막: UAE 최적 달은 11~3월 안에서만 나온다 (모든 출력 지점)', () => {
  const c = climateOf('United Arab Emirates');
  assert.ok(c, 'country-facts.json 에 UAE 기후 기록이 있어야 한다');
  // 글 사이드바·언제갈까 인덱스(bestMonth), 여행지 허브(bestMonths),
  // 나라 페이지 "쉬운 달" 셋(상위 3) — 셋 다 같은 순위를 쓴다.
  assert.ok(UAE_SEASON.includes(bestMonth(c).m), `bestMonth=${bestMonth(c).m}`);
  for (const m of bestMonths(c)) assert.ok(UAE_SEASON.includes(m), `bestMonths 에 ${m}월`);
  const top3 = ranked('United Arab Emirates').slice(0, 3).map((x) => x.m);
  assert.ok(top3.every((m) => UAE_SEASON.includes(m)), `쉬운 달 셋: ${top3}`);
});

test('사막: 한여름 폭염 달은 나쁘게 나온다 (UAE 6~9월, 우즈베키스탄 6~8월)', () => {
  const uae = bandOf('United Arab Emirates');
  assert.ok([6, 7, 8, 9].every((m) => bad(uae[m])), `UAE 6~9월: ${[6, 7, 8, 9].map((m) => uae[m])}`);
  const uz = bandOf('Uzbekistan');
  assert.ok([6, 7, 8].every((m) => bad(uz[m])), `우즈베키스탄 6~8월: ${[6, 7, 8].map((m) => uz[m])}`);
  const uzTop3 = ranked('Uzbekistan').slice(0, 3).map((x) => x.m);
  assert.ok(uzTop3.every((m) => m < 6 || m > 8), `우즈베키스탄 쉬운 달 셋에 한여름: ${uzTop3}`);
});

test('최적 달 위치 고정: 태국·베트남 11~2월, 한국 4·5·10월', () => {
  for (const name of ['Thailand', 'Vietnam']) {
    const top2 = ranked(name).slice(0, 2).map((x) => x.m);
    assert.ok(top2.every((m) => [11, 12, 1, 2].includes(m)), `${name} 상위 둘: ${top2}`);
  }
  const kr = ranked('South Korea').slice(0, 3).map((x) => x.m);
  assert.deepEqual([...kr].sort((a, b) => a - b), [4, 5, 10], `한국 상위 셋: ${kr}`);
});

test('열 벌점은 순위와 무관하다: 모든 달이 38°C 이상이어도 쉬운 달이 되지 않는다', () => {
  const scorching = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, hi: 38 + (i % 3), lo: 28, rain: 2 }));
  const mc = monthComfort(scorching);
  assert.ok(mc.every((x) => x.band !== 'good'), `38~40°C 인 해에 good: ${mc.map((x) => x.band)}`);
  assert.ok(mc.every((x) => x.score <= 1), '점수는 1을 넘지 않는다 (막대 높이가 1 - score)');
});

test('강수 폭이 작은 해에서는 비가 순위를 정하지 않는다', () => {
  // 기온은 같고 비만 0~20mm 로 다른 해. 옛 공식은 20mm 를 강수 축 전체(0.55)로
  // 늘렸다; 이제 20mm 는 40mm 바닥 폭의 절반만큼만 점수를 올린다.
  const dry = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, hi: 22, lo: 14, rain: i === 5 ? 20 : 0 }));
  const mc = monthComfort(dry);
  const gap = mc.find((x) => x.m === 6).score - mc.find((x) => x.m === 1).score;
  assert.ok(Math.abs(gap - 0.55 * 0.5) < 1e-9, `20mm 가 만든 점수 차 ${gap}`);
  // 같은 20mm 라도 비가 몇백 mm 오는 나라에선 비중이 그대로 작다 — 폭이 넓으면 손대지 않는다.
  const wet = dry.map((x) => ({ ...x, rain: x.m === 6 ? 300 : 20 }));
  const wetMc = monthComfort(wet);
  assert.ok(Math.abs(wetMc.find((x) => x.m === 6).score - wetMc.find((x) => x.m === 1).score - 0.55) < 1e-9, '몬순 폭은 전 비중');
});

test('역방향: 강수 폭 40mm 이상·최고 32°C 이하인 나라는 점수가 옛 공식 그대로다', () => {
  const old = (climate) => {
    const rains = climate.map((c) => c.rain);
    const dist = climate.map((c) => Math.abs(c.hi - 22));
    const span = (arr, v) => {
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      return max === min ? 0.5 : (v - min) / (max - min);
    };
    return climate.map((c, i) => span(rains, c.rain) * 0.55 + span(dist, dist[i]) * 0.45);
  };
  let n = 0;
  for (const [name, f] of Object.entries(countries)) {
    const c = f.climate;
    if (!Array.isArray(c) || c.length !== 12) continue;
    const rains = c.map((x) => x.rain);
    if (Math.max(...rains) - Math.min(...rains) < 40 || Math.max(...c.map((x) => x.hi)) > 32) continue;
    n++;
    const now = monthComfort(c).map((x) => x.score);
    old(c).forEach((s, i) => assert.ok(Math.abs(s - now[i]) < 1e-9, `${name} ${i + 1}월: ${s} → ${now[i]}`));
  }
  // 한국·일본·유럽 등이 여기 들어와야 이 테스트가 뭔가를 지킨다.
  assert.ok(n >= 8, `옛 공식과 비교한 나라가 ${n}개뿐이다`);
});

test('열 벌점: 32°C 까지는 0, 그 위로 1°C 마다 정확히 0.08', () => {
  // 22°C 에서 같은 거리(10°C, 12°C)인 추운 달과 더운 달을 짝지어, 기온 순위 몫은
  // 같고 열 벌점만 다르게 만든다. 비는 열두 달 같다.
  const year = (cold, hot) => Array.from({ length: 12 }, (_, i) => ({
    m: i + 1, hi: i === 0 ? cold : i === 6 ? hot : 22, lo: 10, rain: 50,
  }));
  const at = (cold, hot) => {
    const mc = monthComfort(year(cold, hot));
    return mc[6].score - mc[0].score;
  };
  assert.ok(Math.abs(at(12, 32)) < 1e-9, '32°C 는 벌점 없음');
  assert.ok(Math.abs(at(10, 34) - 0.16) < 1e-9, `34°C 는 +0.16 이어야 한다: ${at(10, 34)}`);
});

test('열두 달 강수가 똑같으면 비는 점수에 0을 보탠다 (옛 공식은 일괄 0.5)', () => {
  // 비 차이가 없으면 비는 판단 근거가 아니다 — 22°C 한결같은 해는 전부 good.
  // 지금 country-facts 에는 이런 나라가 없다; 일부러 바꾼 동작이라 여기 박아 둔다.
  const flat = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, hi: 22, lo: 14, rain: 200 }));
  const mc = monthComfort(flat);
  assert.ok(mc.every((x) => Math.abs(x.score - 0.225) < 1e-9 && x.band === 'good'), mc.map((x) => x.score).join(','));
});

// 2026-10-05: 2월 한국 페이지가 이미 지난 2026 설날(2/16~18)과 2027 대체휴일(2/9)을
// 연도 표시 없이 나란히 보여줬다(연휴 있는 190페이지 중 143페이지가 지난 날짜 포함).
// 이제 오늘부터 1년 안의 다음 회차만 — 한 페이지에는 한 해만 나온다.
test('연휴는 다음 회차만: 지난 해와 다음 해가 섞이지 않는다', async () => {
  const { whenToGo } = await import('./when-to-go.mjs');
  const climate = Array.from({ length: 12 }, (_, i) => ({ m: i + 1, hi: 10, lo: 0, rain: 50 }));
  const holidays = [
    { date: '2026-02-16', name: 'Seollal Eve' }, { date: '2026-02-17', name: 'Seollal' }, { date: '2026-02-18', name: 'Day after Seollal' },
    { date: '2027-02-06', name: 'Seollal Eve' }, { date: '2027-02-07', name: 'Seollal' }, { date: '2027-02-08', name: 'Day after Seollal' },
    { date: '2027-02-09', name: 'Alternative holiday for Seollal' },
  ];
  const countryFacts = { countries: { Testland: { climate, holidays } } };
  const dates = (now) => whenToGo('Testland', 2, { countryFacts, now: Date.parse(now) }).holidays.map((h) => h.date);
  assert.deepEqual(dates('2026-10-05T12:00:00Z'), ['2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09']);
  assert.deepEqual(dates('2026-01-10T12:00:00Z'), ['2026-02-16', '2026-02-17', '2026-02-18']);
  // 그 달 안에서 빌드하면 그 달의 남은 날만 — 내년 날짜가 끼어들지 않는다.
  assert.deepEqual(dates('2026-02-17T12:00:00Z'), ['2026-02-17', '2026-02-18']);
  // 이번 달인데 남은 연휴가 없으면 내년 그 달(2/20 빌드 → 2027 설날).
  assert.deepEqual(dates('2026-02-20T12:00:00Z'), ['2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09']);
  // 그 달이 지났으면 내년 그 달.
  assert.deepEqual(dates('2026-03-01T12:00:00Z'), ['2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09']);
});
