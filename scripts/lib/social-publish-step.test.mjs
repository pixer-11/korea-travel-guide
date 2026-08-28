// social-publish-step 회귀 테스트 — 채널별 멱등 판정을 고정한다.
//
//   node --test scripts/lib/social-publish-step.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideWants, socialEnabled } from './social-publish-step.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DAY = '2026-08-28';
const SLUG = 'bangkok-saladaeng';

test('새 날 아침: 스레드는 항상, 인스타는 게시 요일에만 원한다', () => {
  assert.deepEqual(decideWants({ social: {}, day: DAY, slug: SLUG, igDay: true }), { wantTh: true, wantIg: true });
  assert.deepEqual(decideWants({ social: {}, day: DAY, slug: SLUG, igDay: false }), { wantTh: true, wantIg: false });
});

test('오늘 이미 게시한 채널은 다시 원하지 않는다 (아침 3회 시도의 멱등성)', () => {
  const social = { thDay: DAY, thSlug: SLUG, igDay: DAY, igSlug: SLUG };
  assert.deepEqual(decideWants({ social, day: DAY, slug: SLUG, igDay: true }), { wantTh: false, wantIg: false });
});

test('--force 는 오늘 마커를 무시하고 다시 게시한다', () => {
  const social = { thDay: DAY, thSlug: SLUG, igDay: DAY, igSlug: SLUG };
  assert.deepEqual(decideWants({ social, day: DAY, slug: SLUG, force: true, igDay: true }), { wantTh: true, wantIg: true });
});

test('강제 재게시가 실패하면 다음 일반 시도가 새 소재를 재시도한다 (감사 지적)', () => {
  // 2026-08-27 코덱스 감사: 마커가 날짜만 기억해서, 정상 게시 성공 → 새 소재
  // --force 실패 뒤 마커가 "오늘 완료"로 남아 다음 시도가 그냥 지나갔다.
  // 마커는 소재의 신원(slug)도 기억해야 한다.
  const social = { thDay: DAY, thSlug: 'old-material', igDay: DAY, igSlug: 'old-material' };
  assert.deepEqual(decideWants({ social, day: DAY, slug: 'fresh-material', igDay: true }), { wantTh: true, wantIg: true });
});

test('슬러그 없는 옛 상태는 재게시하지 않는다 (마이그레이션 안전)', () => {
  const social = { thDay: DAY, igDay: DAY };
  assert.deepEqual(decideWants({ social, day: DAY, slug: SLUG, igDay: true }), { wantTh: false, wantIg: false });
});

test('socialEnabled: 금고 파일이 있으면 부트스트랩 시크릿이 없어도 켜진다 (감사 지적)', () => {
  // 2026-08-27 코덱스 감사: 켜짐 판정은 부트스트랩 시크릿을 요구하는데 실제
  // 토큰은 금고에서 온다 — 나중에 시크릿만 지우면 멀쩡한 금고가 잠든다.
  const dir = mkdtempSync(join(tmpdir(), 'sps-'));
  const saved = {};
  for (const k of ['SOCIAL_TOKEN_KEY', 'INSTAGRAM_ACCESS_TOKEN', 'THREADS_ACCESS_TOKEN']) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    const store = join(dir, 'store.enc');
    writeFileSync(store, 'x');
    process.env.SOCIAL_TOKEN_KEY = '열쇠';
    assert.equal(socialEnabled(store), true, '금고 파일+열쇠인데 꺼짐');
    assert.equal(socialEnabled(join(dir, 'missing.enc')), false, '금고도 부트스트랩도 없는데 켜짐');
    process.env.INSTAGRAM_ACCESS_TOKEN = 'ig';
    assert.equal(socialEnabled(join(dir, 'missing.enc')), false, '부트스트랩 반쪽인데 켜짐 (loadTokens 는 둘 다 요구)');
    process.env.THREADS_ACCESS_TOKEN = 'th';
    assert.equal(socialEnabled(join(dir, 'missing.enc')), true, '부트스트랩 온전한데 꺼짐');
    delete process.env.SOCIAL_TOKEN_KEY;
    assert.equal(socialEnabled(store), false, '열쇠가 없는데 켜짐');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});
