// 야간 사진 순찰의 대상 선정 회귀 테스트.
//
// 이 조건식은 같은 방식으로 두 번 뚫렸다: 2026-08-10 사진 없이 공개된 이벤트
// 51편, 2026-08-14 신원 불일치로 히어로가 제거된 가게 글 11편 중 6편. 둘 다
// "공개돼 있고, 사진이 없고, 아무 조건에도 안 걸려서 다시는 탐색되지 않는"
// 같은 모양이다. 그래서 **양방향**이 똑같이 중요하다 — 사각이 닫혔는가, 그리고
// 멀쩡한 글까지 매일 밤 비전 검사에 올리지는 않는가.
//   node scripts/lib/patrol-target.test.mjs
import { isPatrolTarget, isPhotolessLive } from './patrol-target.mjs';

const HERO = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/x.jpg/1200px-x.jpg';

const cases = [
  // ── 사각이 닫혔는가 (반드시 대상) ──────────────────────────────────────
  ['photoless live venue — 08-14 신원 제거분', { draft: false, heroUrl: '' }, true],
  ['photoless live event — 08-10 released', { draft: false, heroUrl: '' }, true],
  ['draft(격리) 글은 계속 대상', { draft: true, heroUrl: HERO }, true],
  ['현재 히어로에 MISMATCH 판정', { draft: false, heroUrl: HERO, flaggedNow: true }, true],
  ['placeholder 히어로', { draft: false, heroUrl: 'https://x/placeholder.jpg' }, true],
  ['draft 인데 사진도 없음', { draft: true, heroUrl: '' }, true],

  // ── 과잉으로 번지지는 않는가 (대상이 아니어야) ────────────────────────
  ['건강한 라이브 글은 건드리지 않는다', { draft: false, heroUrl: HERO }, false],
  ['옛 히어로에 대한 판정은 현재 사진을 유죄로 만들지 않는다',
    { draft: false, heroUrl: HERO, flaggedNow: false }, false],
  ['draft 필드가 아예 없는 라이브 글', { draft: undefined, heroUrl: HERO }, false],

  // ── 수동 스위치는 그대로 ──────────────────────────────────────────────
  ['AUDIT_ALL=1 은 전부 대상', { draft: false, heroUrl: HERO, auditAll: true }, true],
  ['SLUGS 로 지명하면 대상', { draft: false, heroUrl: HERO, named: true }, true],

  // ── 08-19 비용 규칙: 이미 판정된 건 다시 묻지 않는다 / 사진 문제 아닌 격리는 안 건드린다 ──
  ['AUDIT_ALL 이어도 현재 히어로가 이미 MATCH면 대상 아님(어젯밤 957편 중복 판정)',
    { draft: false, heroUrl: HERO, auditAll: true, clearedHero: true }, false],
  ['AUDIT_ALL + MATCH 없음 → 대상', { draft: false, heroUrl: HERO, auditAll: true, clearedHero: false }, true],
  ['MATCH 기록이 있어도 MISMATCH로 새로 찍혔으면 대상', { draft: false, heroUrl: HERO, flaggedNow: true, clearedHero: true }, true],
  ['게이트 hold(content)는 사진 순찰 대상 아님', { draft: true, heroUrl: HERO, heldReason: 'content' }, false],
  ['게이트 hold(hours)도 아님', { draft: true, heroUrl: HERO, heldReason: 'hours' }, false],
  ['generic-topic 격리도 아님', { draft: true, heroUrl: HERO, heldReason: 'generic-topic' }, false],
  ['duplicate(중복 이벤트 비공개)도 아님 — 사진은 멀쩡, 재공개 금지', { draft: true, heroUrl: HERO, heldReason: 'duplicate' }, false],
  ['past-event(지난 회차를 예정으로 낸 글)도 아님 — 재공개 금지', { draft: true, heroUrl: HERO, heldReason: 'past-event' }, false],
  ['cancelled(주최측 취소)도 아님 — 재공개 금지', { draft: true, heroUrl: HERO, heldReason: 'cancelled' }, false],
  ['사진류 hold(wrong-venue-photo)는 여전히 대상', { draft: true, heroUrl: HERO, heldReason: 'wrong-venue-photo' }, true],
  ['SLUGS 지명은 hold 종류와 무관하게 대상', { draft: true, heroUrl: HERO, heldReason: 'content', named: true }, true],
];

let fail = 0;
for (const [name, input, want] of cases) {
  const got = isPatrolTarget(input);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — expected ${want}, got ${got}`);
  if (!ok) fail++;
}

// isPhotolessLive 자체도 못 박아 둔다: 이 함수가 이벤트 여부를 다시 보게 되면
// 08-14 사각이 그대로 되살아난다.
for (const [name, input, want] of [
  ['공개 + 사진 없음', { draft: false, heroUrl: undefined }, true],
  ['격리 + 사진 없음 → 이 규칙의 대상 아님(draft 규칙이 잡는다)', { draft: true, heroUrl: '' }, false],
  ['공개 + 사진 있음', { draft: false, heroUrl: HERO }, false],
]) {
  const got = isPhotolessLive(input);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  isPhotolessLive: ${name}`);
  if (!ok) fail++;
}

process.exit(fail ? 1 : 0);
