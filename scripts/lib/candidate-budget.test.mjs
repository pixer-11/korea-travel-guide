// 후보 탐색 예산 — 실제로 관측된 세 글의 모양을 그대로 시나리오로 굳힌 것.
//   node --test scripts/lib/candidate-budget.test.mjs
//
// 2026-08-30: 파일명 거절은 비전 호출이 없어 공짜인데, 그 공짜가 "비전에 보낼
// 네 장을 찾으라"고 준 12턴을 다 써버렸다(푸켓: 12턴 중 11턴). 그래서 공짜에는
// 따로 예산을 줬는데 — 그러면 검색 자체가 망가진 글에서 쓰레기를 더 깊이 파게
// 된다. U-Know 글은 17턴을 파서 스캔된 옛날 책장("Do you know? - DPLA")만
// 긁어왔다. 그 둘을 가르는 신호는 총 거절 수가 아니라 '연속' 거절이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateBudget, DEAD_END_REFUSALS, MAX_CANDIDATE_TURNS } from './candidate-budget.mjs';

// 대본대로 후보를 뱉는 가짜 검색을 예산에 물려 돌린다.
// 'r' = 파일명 거절, 'j' = 이미 비전이 판정한 파일, 'a' = 비전에 보낼 후보.
const run = (script) => {
  const b = candidateBudget();
  let turns = 0;
  while (b.keepGoing()) {
    const step = script[turns];
    if (!step) break; // 검색이 더 내놓을 게 없다
    b.turned(); turns++;
    if (step === 'r') b.refused();
    else if (step === 'j') b.alreadyJudged();
    else b.accepted();
  }
  return { turns, found: b.found };
};
const seq = (...parts) => parts.join('');

test('공짜 거절이 비전 예산을 먹지 않는다 (푸켓: 12턴 중 11턴을 거절에 썼다)', () => {
  // 거절 9장 뒤에 진짜 파일 4장 = 13턴. 옛 규칙(12턴 고정)이면 3장에서 끊긴다.
  const { found } = run(seq('r'.repeat(9), 'aaaa'));
  assert.equal(found, 4, '거절을 지나 네 장까지 채워야 한다');
});

test('연속 거절이 문턱을 넘으면 뒤에 진짜 파일이 있어도 멈춘다 — 의도된 손해', () => {
  // 이 문턱은 공짜로 얻는 게 아니다. 막다른 검색과 '거절이 길게 이어지다 진짜
  // 파일이 나오는 검색'은 그 자리에서 구별되지 않으므로, 후자를 포기한다.
  // 이벤트 글은 정책상 사진 없이 나갈 수 있고(wander-atlas-photoless-policy),
  // 사진이 없는 것보다 '남의 공연 사진'이 훨씬 비싸다 — F1_Rocks_Singapore.
  const { found } = run(seq('r'.repeat(DEAD_END_REFUSALS + 1), 'aaaa'));
  assert.equal(found, 0, '사진 없이 두는 쪽을 택한다');
});

test('거절 사이에 진짜 후보가 섞이면 12턴을 넘겨 계속 판다 (paris-plk: 최대 연속 6)', () => {
  // 실제 08-30 실행 모양: 3거절-후보-3거절-후보-6거절-후보-2거절-후보.
  const { turns, found } = run(seq('rrr', 'a', 'rrr', 'a', 'rrrrrr', 'a', 'rr', 'a'));
  assert.equal(found, 4);
  assert.ok(turns > MAX_CANDIDATE_TURNS, `12턴을 넘겨야 한다 (실제 ${turns})`);
});

test('연속 거절만 쌓이면 막다른 검색으로 보고 멈춘다 (U-Know: 17턴째의 쓰레기)', () => {
  // 16연속 거절 뒤 17번째에 의심스러운 파일 하나. 거기까지 가면 안 된다.
  const { turns, found } = run(seq('r'.repeat(16), 'a'));
  assert.equal(found, 0, '막다른 검색에서는 비전에 아무것도 올리지 않는다');
  assert.ok(turns <= DEAD_END_REFUSALS, `연속 거절 ${DEAD_END_REFUSALS}에서 멈춰야 한다 (실제 ${turns})`);
});

test('비전이 이미 판정한 파일은 검색이 살아 있다는 증거 — 연속을 끊는다', () => {
  // paris-plk 실전: 4번째와 8번째 후보는 파일명은 통과했지만 감사 기록에
  // MISMATCH가 있어 건너뛴다. 그것까지 '연속 거절'로 세면 건강한 글이 멈춘다.
  const { found } = run(seq('rrr', 'j', 'rrr', 'j', 'rrrrrr', 'a', 'rr', 'a'));
  assert.equal(found, 2, '이미 판정된 파일이 연속을 끊어 뒤의 진짜 후보까지 간다');
});

test('거절이 없으면 옛 규칙과 똑같다 — 12턴, 네 장', () => {
  const { turns, found } = run('a'.repeat(40));
  assert.equal(found, 4);
  assert.equal(turns, 4, '네 장을 채우면 즉시 멈춘다');
  const only3 = run('aaa');
  assert.equal(only3.turns, 3, '검색이 마르면 그 자리에서 끝난다');
});

test('바닥 없는 검색에도 천장이 있다', () => {
  // 거절과 후보가 번갈아 나오면 연속은 1로 계속 초기화된다 — 천장이 없으면
  // Commons를 무한히 두드린다. found 는 4에서 멈추니 4장 채우기 전에 마르는
  // 대본으로 확인한다.
  // 5거절 뒤 '이미 판정됨'이 반복되면 연속은 5로만 차오르고, 후보는 하나도
  // 담기지 않는다 — 천장이 없으면 Commons 를 끝없이 두드린다.
  const { turns, found } = run(seq('rrrrrj'.repeat(50)));
  assert.equal(found, 0);
  assert.equal(turns, 30, `천장 30턴에서 멈춘다 (실제 ${turns})`);
});
