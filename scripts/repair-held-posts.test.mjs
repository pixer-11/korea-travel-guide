// repair-held-posts 회귀 테스트 — 해제는 기록된 모든 사유가 재검사를 통과해야 한다.
//
// 게이트는 `heldReason: hours+wrong-region` 처럼 사유를 전부 적는다. 이 순찰이
// 영업시간 감사만 다시 돌리고 해제하던 동안 잘못된 구역이 그대로 발행됐고
// (코덱스 1차), 구역만 재검사하던 동안 `hours+content` 가 content 결함째 풀렸으며
// 검사기가 죽어 stdout 이 비면 "지적 없음"으로 읽혀 역시 풀렸다(코덱스 2차).
//
//   node --test scripts/repair-held-posts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'repair-held-posts.mjs');
const NOOP = 'node -e "process.exit(0)"';
const CRASH = 'node -e "process.exit(2)"'; // exit ≠ 0 인데 stdout 이 없다 = 죽음
// 진행 한 줄 찍고 죽는 검사기. 예전엔 "stdout 이 비지 않았다"는 이유로 정상 판정이
// 됐고, 지적이 하나도 없으니 격리가 풀렸다(코덱스 3차).
const NOISY_CRASH = 'node -e "console.log(1); process.exit(2)"';
// 사본의 작은따옴표 문자열 안으로 들어가므로 백슬래시를 한 겹 더 입힌다.
const FLAG_REGION = `node -e "console.log(\\\\"REGION-OUTLIER: fixture.md 18 km from the Sai Kung centre\\\\"); process.exit(1)"`;

const FLAG_CLOSED = `node -e "console.log(\\\\"NON-OPERATIONAL-VENUE: fixture.md — CLOSED_TEMPORARILY\\\\"); process.exit(1)"`;

// 스크립트 사본을 임시 저장소(빈 posts 폴더 + fixture 1편)에서 돌린다. 진짜
// 검사기·수리기·번역기는 전부 가짜 명령으로 바꾼다 — 작은따옴표는 쓰지 않는다
// (스크립트의 명령 문자열이 작은따옴표라 사본이 SyntaxError 로 죽는다).
function runWith({ heldReason, region = NOOP, hours = NOOP, closed = NOOP }) {
  const root = mkdtempSync(join(tmpdir(), 'repair-held-'));
  const dir = join(root, 'src', 'content', 'posts');
  mkdirSync(dir, { recursive: true });
  const fixture = join(dir, 'fixture.md');
  writeFileSync(fixture, `---\ndraft: true\nheldReason: ${heldReason}\ntitle: X\n---\nbody\n`, 'utf8');
  try {
    let src = readFileSync(SCRIPT, 'utf8');
    const swap = (from, to) => {
      assert.ok(src.includes(from), `script no longer contains: ${from}`);
      src = src.split(from).join(to);
    };
    swap('node scripts/audit-hours-claims.mjs --drafts', hours);
    swap('node scripts/audit-region-outliers.mjs --drafts', region);
    swap('node scripts/audit-closed-venues.mjs --drafts', closed);
    // 사본은 임시 폴더에 있으므로 상대 import 가 풀리지 않는다. 진짜 모듈을 절대
    // 경로로 가리킨다 — 그래야 그 모듈의 node_modules 해석도 함께 산다.
    swap("from './lib/frontmatter-edit.mjs'",
      `from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'scripts', 'lib', 'frontmatter-edit.mjs')).href)}`);
    src = src.replace(/node scripts\/fix-hours-claims\.mjs[^`']*/g, NOOP);
    src = src.replace(/node scripts\/translate-posts\.mjs[^`']*/g, NOOP);
    const p = join(root, 'repair.mjs');
    writeFileSync(p, src, 'utf8');
    let out;
    try { out = execFileSync(process.execPath, [p], { encoding: 'utf8', cwd: root }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    assert.ok(!/SyntaxError/.test(out), `사본이 죽음: ${out.slice(-300)}`);
    return { out, file: readFileSync(fixture, 'utf8') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const stillHeld = (r, reason) => {
  assert.match(r.file, /^draft: true$/m, `해제됨:\n${r.out}`);
  assert.match(r.file, new RegExp(`^heldReason: ${reason.replace(/\+/g, '\\+')}$`, 'm'));
  assert.match(r.out, /REPAIRED 0 of 1/);
};

test('영업시간은 풀렸어도 구역이 아직 어긋나면 해제하지 않는다', () => {
  const r = runWith({ heldReason: 'hours+wrong-region', region: FLAG_REGION });
  stillHeld(r, 'hours+wrong-region');
  assert.match(r.out, /wrong-region 결함이 여전함/);
});

test('hours+content: 영업시간이 고쳐져도 content 는 재검사 도구가 없으니 보류', () => {
  const r = runWith({ heldReason: 'hours+content' });
  stillHeld(r, 'hours+content');
  assert.match(r.out, /content 사유는 초안을 재검사할 도구가 없음/);
});

test('hours+wrong-venue-photo 도 마찬가지로 보류', () => {
  const r = runWith({ heldReason: 'hours+wrong-venue-photo' });
  stillHeld(r, 'hours+wrong-venue-photo');
});

test('검사기가 결과 없이 죽으면 통과가 아니다 (fail closed)', () => {
  const r = runWith({ heldReason: 'hours+wrong-region', region: CRASH });
  stillHeld(r, 'hours+wrong-region');
  assert.match(r.out, /wrong-region 검사기가 결과 없이 죽음/);
});

test('두 사유가 모두 풀리면 해제한다', () => {
  const r = runWith({ heldReason: 'hours+wrong-region' });
  assert.match(r.file, /^draft: false$/m, `해제 안 됨:\n${r.out}`);
  assert.ok(!/^heldReason:/m.test(r.file), 'heldReason 이 남아 있음');
  assert.match(r.out, /REPAIRED 1 of 1/);
  assert.match(r.out, /hours\+wrong-region 전부 통과/);
});

// 2026-09-03 3차: 진입 목록이 'hours' 를 요구해서, wrong-region 하나만 적힌 글은
// CHECKERS 에 검사기가 있는데도 루프에 들어오지도 못했다. 그날 격리된 14편 전부가
// 비-hours 사유였고 스크립트는 "수리할 격리 글 없음" 만 찍었다.

test('사유가 wrong-region 하나뿐이어도 재검사해서 해제한다', () => {
  const r = runWith({ heldReason: 'wrong-region' });
  assert.match(r.file, /^draft: false$/m, `해제 안 됨:\n${r.out}`);
  assert.ok(!/^heldReason:/m.test(r.file), 'heldReason 이 남아 있음');
  assert.match(r.out, /REPAIRED 1 of 1/);
  assert.match(r.out, /wrong-region 전부 통과/);
});

test('사유가 wrong-region 하나뿐이고 아직 어긋나면 그대로 격리', () => {
  const r = runWith({ heldReason: 'wrong-region', region: FLAG_REGION });
  stillHeld(r, 'wrong-region');
  assert.match(r.out, /wrong-region 결함이 여전함/);
});

test('검사기 없는 사유 하나뿐이면 루프에는 들어오되 해제되지 않는다', () => {
  const r = runWith({ heldReason: 'wrong-venue-photo' });
  stillHeld(r, 'wrong-venue-photo');
  assert.match(r.out, /wrong-venue-photo 사유는 초안을 재검사할 도구가 없음/);
});

test('검사기가 뭔가 찍고 죽어도 통과가 아니다 (fail closed)', () => {
  const r = runWith({ heldReason: 'wrong-region', region: NOISY_CRASH });
  stillHeld(r, 'wrong-region');
  assert.match(r.out, /wrong-region 검사기가 결과 없이 죽음/);
});

// 2026-09-08 (코덱스 3차): 위의 테스트들은 가짜 검사기가 REGION-OUTLIER 줄을 찍어
// 주므로 전부 통과했지만, 진짜 audit-region-outliers 는 초안을 "(held draft, not
// counted)" 로만 적고 그 줄은 pick 에 걸리지 않았다 — 아직 구역이 틀린 초안이
// "결함 사라짐"으로 읽혀 다시 발행됐다. 가짜로는 못 잡는 부류라, 진짜 소스의
// CHECKERS 표를 직접 읽어 불변식을 지킨다.
test('격리 해제의 재검사 명령은 전부 초안까지 판정해야 한다(--drafts)', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const block = src.match(/const CHECKERS = \{[\s\S]*?\n\};/);
  assert.ok(block, 'CHECKERS 표를 찾지 못함 — 이 테스트가 아무것도 지키지 않는다');
  const cmds = [...block[0].matchAll(/cmd:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(cmds.length > 0, 'CHECKERS 에서 cmd 를 하나도 읽지 못함');
  for (const cmd of cmds) {
    assert.ok(cmd.includes('--drafts'),
      `초안을 건너뛰는 검사기는 격리를 잘못 풀어준다: ${cmd}`);
  }
});

// ── heldFinal: 기계가 영영 못 고치는 것은 매일 재시도하지 않는다 (2026-09-10) ──
// 15편 중 13편이 "재검사할 도구가 없음"으로 매일 같은 ✗ 줄을 찍었다. 그중 5편은
// 고칠 수 없는 게 아니라 **고칠 필요가 없는 것**이었다 — 이미 발행된 글의 중복본,
// 취소된 공연, 지난 공연. 결정을 파일에 적고 순찰이 건너뛴다.
// 파일 자체는 지우지 않는다: draft:true 가 옛 URL → 지역 허브 302를 만든다.
test('heldFinal 이 적힌 초안은 수리 대상에서 빠진다', () => {
  const marked = `---\ndraft: true\nheldReason: duplicate\nheldFinal: 'already published elsewhere'\n---\n`;
  const plain = `---\ndraft: true\nheldReason: duplicate\n---\n`;
  const note = (raw) => (raw.match(/^heldFinal:(.*)$/m)?.[1] ?? '').trim();
  assert.notEqual(note(marked), '', 'heldFinal 을 못 읽으면 매일 재시도한다');
  assert.equal(note(plain), '', '표시 없는 초안까지 건너뛰면 수리가 멈춘다');
});

test('🛑 heldFinal 은 draft 를 건드리지 않는다 — 발행되면 안 된다', () => {
  const marked = `---\ndraft: true\nheldReason: duplicate\nheldFinal: 'x'\n---\n`;
  assert.match(marked, /^draft:\s*true/m);
});

// ── closed: 2026-09-10 에 재검사 도구가 생겼다 ────────────────────────────
// 그전까지 closed 는 나갈 길이 없는 사유였다. 검사기는 API 를 쓰지 않고
// refresh.mjs 가 이미 저장해 둔 businessStatus 를 읽는다. 양방향 둘 다 지킨다:
// 아직 닫혀 있으면 붙잡고, 다시 열렸으면 그날로 푼다.
test('closed: 장소가 아직 닫혀 있으면 격리를 유지한다', () => {
  const r = runWith({ heldReason: 'closed', closed: FLAG_CLOSED });
  stillHeld(r, 'closed');
  assert.match(r.out, /closed 결함이 여전함/);
  assert.doesNotMatch(r.out, /closed 사유는 초안을 재검사할 도구가 없음/);
});

test('closed: 장소가 다시 열렸으면 해제한다', () => {
  const r = runWith({ heldReason: 'closed' });
  assert.match(r.file, /^draft: false$/m, '다시 열렸는데도 격리가 남았다');
  assert.doesNotMatch(r.file, /^heldReason:/m);
  assert.match(r.out, /REPAIRED 1 of 1/);
});

// 게이트가 사유를 따옴표로 적으면(heldReason: 'closed') 조회 키에 따옴표가 섞여
// 검사기가 있는데도 "재검사할 도구가 없음" 으로 읽혔다 — little-india 가 그렇게
// 매일 밤 같은 줄을 찍었다(2026-09-10).
test('따옴표가 붙은 사유도 자기 검사기를 찾는다', () => {
  const r = runWith({ heldReason: "'closed'", closed: FLAG_CLOSED });
  assert.match(r.out, /closed 결함이 여전함/);
  assert.doesNotMatch(r.out, /재검사할 도구가 없음/);
});
