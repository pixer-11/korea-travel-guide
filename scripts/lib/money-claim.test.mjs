import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyClaims } from './money-claim.mjs';

test('지어낸 가격은 통화 표기가 무엇이든 잡는다', () => {
  const cases = [
    'expect roughly 300–600 THB per person for a Thai main',
    'budget around 1,500–2,500 yen per person and 45–75 minutes',
    'Standing pintxos with a drink run roughly €3-5 each',
    'expect roughly Rp150,000–400,000 per person depending on how',
    'a taxi (about 20–25 minutes, roughly ₩20,000–25,000 depending on traffic)',
    'visitors pay a set entrance fee (historically around 500 THB)',
  ];
  for (const c of cases) assert.equal(moneyClaims(c).length >= 1, true, c);
});

test('오늘 낼 돈이 아닌 액수는 통과시킨다 — 사실이지 가격이 아니다', () => {
  // 싱가포르 식물원 글의 진짜 문장: 나무가 옛 5달러 지폐에 그려져 있다.
  assert.deepEqual(moneyClaims('its low, gnarled branch is the one on the old Singapore $5 note'), []);
  assert.deepEqual(moneyClaims('the hall was built for $2 million in 1961'), []);
});

test('중국어 병음 주소의 Dong 을 베트남 동으로 읽지 않는다', () => {
  assert.deepEqual(moneyClaims('The museum sits at 16 Dong Chang An Jie, forming the eastern wall'), []);
  assert.deepEqual(moneyClaims("It's at 9 Dong Da Zhi Jie in Nangang District"), []);
});

test('금액 없는 가격 표현은 건드리지 않는다', () => {
  assert.deepEqual(moneyClaims("It's mid-range for Bilbao, on the pricier side for the area."), []);
  assert.deepEqual(moneyClaims('Entry is free; donation boxes sit by the shrine.'), []);
});

// ── 배선과 프롬프트를 고정한다 (2026-09-21) ──────────────────
// 감사만 만들고 프롬프트를 그대로 두면 매일 새 결함이 태어난다. 원인 두 곳이
// 닫혀 있는지, 그리고 감사가 발행 파이프라인에 걸려 있는지를 테스트가 지킨다.
test('생성기가 더는 가격을 묻지도, 지어내도 된다고 하지도 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const w = readFileSync('scripts/lib/writer.mjs', 'utf8');
  assert.doesNotMatch(w, /phrase it as approximate and time-bounded/, '얼버무림 탈출구가 살아 있다');
  assert.match(w, /Never write an amount of money in any currency/, '금액 금지 규칙이 없다');
  const faq = w.match(/description: '4-5 concise[^']*'/);
  assert.ok(faq, 'FAQ 스키마 설명을 찾지 못했다');
  assert.doesNotMatch(faq[0], /\bcost\b(?![^']*can only be invented)/, 'FAQ 스키마가 아직 비용을 물으라고 시킨다');
});

test('발행 파이프라인이 이 감사를 부른다', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
  assert.match(yml, /node scripts\/audit-money-claims\.mjs/, '발행이 가격 감사를 부르지 않는다');
});
