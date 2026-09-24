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

test('유명한 옛 메뉴 가격도 가격이다 — "built with" 는 건설비가 아니다 (09-25)', () => {
  // 호찌민 Pot au Phở 2.0 초안의 진짜 문장. 맨 "built" 예외가 이 금액을 풀어 줬다.
  assert.equal(moneyClaims('made international headlines for a bowl of phở priced at $100, built with luxury ingredients').length, 1);
  assert.equal(moneyClaims('If you loved the original "$100 phở" concept, ask staff').length, 1);
  assert.equal(moneyClaims('serving a single ¥1,880 tasting menu built around premium seafood').length, 1);
  // 역방향: 좁힌 예외가 진짜 건설비까지 잡으면 안 된다(코덱스 09-25).
  assert.deepEqual(moneyClaims('the tower was built in 1961 at a cost of $2 million'), []);
  assert.deepEqual(moneyClaims('the bridge was built in 1932 for $4 million'), []);
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

// ── 09-25: 수리 도구는 있었지만 어디에도 연결되지 않았고, 옆자리 평점 수리는
// 마지막 커밋 뒤에서 돌아 고친 것이 러너와 함께 사라졌다. 그리고 감사 하나가
// 실패하면 bash -e 가 그 뒤의 감사·수리를 전부 건너뛰었다.
test('발행이 금액·평점 수리를 돌리고, 그 결과를 커밋한다', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
  const repair = yml.indexOf('node scripts/repair-money-claims.mjs');
  const rating = yml.indexOf('node scripts/repair-rating-floor.mjs');
  const push = yml.indexOf('- name: Push what the content repairs changed');
  const audit = yml.indexOf('node scripts/audit-money-claims.mjs');
  assert.ok(repair > -1, '금액 수리가 파이프라인에 없다');
  assert.ok(rating > -1, '평점 수리가 파이프라인에 없다');
  assert.ok(push > repair && push > rating, '수리 뒤에 커밋 단계가 없다 — 고친 것이 러너와 함께 사라진다');
  assert.ok(audit > push, '감사가 수리·커밋보다 먼저 돈다');
});

test('검증 단계는 감사 하나가 실패해도 나머지를 끝까지 돌린다', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
  const start = yml.indexOf('- name: Validate content integrity');
  const step = yml.slice(start, yml.indexOf('\n      - name:', start + 10));
  const lines = step.split('\n').filter((l) => /^\s+node scripts\//.test(l));
  assert.ok(lines.length >= 8, `검증 단계의 감사 줄을 못 찾았다 (${lines.length})`);
  for (const l of lines) assert.match(l, /\|\| rc=1\s*$/, `실패가 뒤를 끊는 줄: ${l.trim()}`);
  assert.match(step, /exit \$rc/, '끝에서 모은 실패를 돌려주지 않는다 — 경고 단계가 안 뜬다');
});
