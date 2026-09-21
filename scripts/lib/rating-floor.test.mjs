// 평점 기준선 + 떨림 방지 (2026-09-22).
//
// 밀토스트 익선점(3.9·리뷰 1,248)이 8월 5일부터 공개돼 있었다. 규칙을 어긴 게 아니라
// `place` 블록 없이 태어나 **읽을 평점이 없었던** 것이고, 검사기는 없는 것을 못 본다.
// 여기서 고정하는 것: 약속(4.0)을 지키되, 4.0 근처를 오가는 장소가 매주 내렸다 올라가지 않게 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { belowFloor, FLOOR, RECOVER } from './rating-floor.mjs';

test('공개글은 4.0 미만이면 내린다', () => {
  assert.equal(belowFloor(3.9), true);
  assert.equal(belowFloor(3.99), true);
  assert.equal(belowFloor(4.0), false, '기준선 자체는 통과다');
  assert.equal(belowFloor(4.6), false);
});

test('🔁 떨림 방지: 되올리려면 4.1 이상이어야 한다', () => {
  // 격리된 글(isHeld=true)은 4.0 을 겨우 넘긴 것으로는 안 풀린다.
  assert.equal(belowFloor(4.0, true), true, '4.0 으로는 아직 부족하다');
  assert.equal(belowFloor(4.05, true), true);
  assert.equal(belowFloor(RECOVER, true), false, '4.1 이면 풀린다');
  // 실측 근거: 공개글 1,465편 중 38편이 4.0~4.09 구간에 있었다.
  assert.equal(FLOOR < RECOVER, true, '두 문턱이 같으면 떨림이 생긴다');
});

test('평점이 없으면 판정하지 않는다 — 없는 것을 결함으로 읽지 않는다', () => {
  for (const v of [undefined, null, 0, NaN, 'n/a']) assert.equal(belowFloor(v), false);
});

test('배선: refresh 가 내리고, 수리 순찰이 되올린다', async () => {
  const { readFileSync } = await import('node:fs');
  const refresh = readFileSync('scripts/refresh.mjs', 'utf8');
  assert.match(refresh, /belowFloor\(parsed\.data\.place\?\.rating\)/, 'refresh 가 기준선을 보지 않는다');
  assert.match(refresh, /heldReason = 'rating'/, '사유를 남기지 않으면 되올릴 수 없다');
  const repair = readFileSync('scripts/repair-held-posts.mjs', 'utf8');
  assert.match(repair, /rating: \{ cmd: 'node scripts\/audit-rating-floor\.mjs --drafts'/, '수리 순찰이 rating 을 재검사하지 않는다');
});
