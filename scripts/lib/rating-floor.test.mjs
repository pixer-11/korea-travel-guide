// 평점 기준선 + 떨림 방지 (2026-09-22).
//
// 밀토스트 익선점(3.9·리뷰 1,248)이 8월 5일부터 공개돼 있었다. 규칙을 어긴 게 아니라
// `place` 블록 없이 태어나 **읽을 평점이 없었던** 것이고, 검사기는 없는 것을 못 본다.
// 여기서 고정하는 것: 약속(4.0)을 지키되, 4.0 근처를 오가는 장소가 매주 내렸다 올라가지 않게 한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { belowFloor, FLOOR, RECOVER, HOLD_REASON, isRatingHold } from './rating-floor.mjs';

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
  assert.match(refresh, /heldReason = HOLD_REASON/, '사유를 남기지 않으면 되올릴 수 없다');
  const repair = readFileSync('scripts/repair-held-posts.mjs', 'utf8');
  assert.match(repair, /rating: \{ cmd: 'node scripts\/audit-rating-floor\.mjs --drafts'/, '수리 순찰이 rating 을 재검사하지 않는다');
});

// 2026-09-22: 한 사유가 두 철자로 적혀 있었고, 시스템의 두 반쪽이 각각 하나씩만
// 알았다. 판정은 둘 다 받아야 하고(이미 디스크에 적힌 것), 기계가 적는 철자는
// 하나여야 한다(검사기 표의 키와 같아야 하므로).
test('평점 보류는 두 철자 모두로 알아본다', () => {
  for (const r of ['rating', 'below-rating-floor', 'hours+rating', 'hours+below-rating-floor']) {
    assert.equal(isRatingHold(r), true, r);
  }
  for (const r of ['', undefined, 'hours', 'closed', 'wrong-region', 'crowd-claims']) {
    assert.equal(isRatingHold(r), false, String(r));
  }
});

test('기계가 적는 철자는 수리 순찰의 검사기 표에 실제로 있는 키다', async () => {
  const { readFileSync } = await import('node:fs');
  const repair = readFileSync('scripts/repair-held-posts.mjs', 'utf8');
  assert.ok(
    repair.includes(`  ${HOLD_REASON}: { cmd:`) || repair.includes(`  '${HOLD_REASON}': { cmd:`),
    `CHECKERS 에 ${HOLD_REASON} 키가 없으면 그 보류는 영영 안 풀린다`,
  );
  // 09-16 에 손으로 적힌 다른 철자도 자기 검사기를 찾아야 한다.
  assert.ok(repair.includes("  'below-rating-floor': { cmd:"), 'below-rating-floor 검사기 없음');
});

test('사진 순찰은 평점 보류를 두 철자 모두에서 건드리지 않는다', async () => {
  const { NON_PHOTO_HOLD } = await import('./patrol-target.mjs');
  for (const r of ['rating', 'below-rating-floor']) assert.equal(NON_PHOTO_HOLD.test(r), true, r);
});

// 감사만으로는 아무 일도 일어나지 않는다 (2026-09-22).
// geocode 가 서울·도쿄의 좌표 없던 글에 평점을 붙이자 4.0 미만 3편이 드러났는데,
// refresh 의 기준선 검사는 그날 갱신하는 40편 안에서만 돌아 셋 다 공개로 남았다.
// 순번은 최대 12주 뒤였고, 감사는 매일 찾아내고만 있었다.
test('수리 도구가 존재하고 파이프라인이 감사보다 먼저 그것을 부른다', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  assert.equal(existsSync('scripts/repair-rating-floor.mjs'), true, '수리 도구가 없다');
  const repair = readFileSync('scripts/repair-rating-floor.mjs', 'utf8');
  // 판정과 철자는 한 곳에서만 온다 — 09-22 의 '두 철자' 사고가 그래서 났다.
  assert.match(repair, /from '\.\/lib\/rating-floor\.mjs'/);
  assert.match(repair, /HOLD_REASON/, '사유를 남기지 않으면 되올릴 수 없다');
  assert.match(repair, /editFrontmatter/, '프론트매터는 공용 편집기로만 고친다');
  const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
  const iRepair = yml.indexOf('node scripts/repair-rating-floor.mjs');
  const iAudit = yml.indexOf('node scripts/audit-rating-floor.mjs');
  assert.equal(iRepair > -1 && iAudit > -1, true, '둘 다 발행 파이프라인에 있어야 한다');
  assert.equal(iRepair < iAudit, true, '수리가 감사보다 먼저 돌아야 감사가 남은 것만 보고한다');
});

test('이미 내려간 글과 이벤트는 건드리지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const repair = readFileSync('scripts/repair-rating-floor.mjs', 'utf8');
  assert.match(repair, /d\.draft \|\| d\.category === 'event'/, '초안·이벤트 제외가 없다');
});
