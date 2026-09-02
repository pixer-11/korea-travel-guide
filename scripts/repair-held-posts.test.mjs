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
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'repair-held-posts.mjs');
const NOOP = 'node -e "process.exit(0)"';
const CRASH = 'node -e "process.exit(2)"'; // exit ≠ 0 인데 stdout 이 없다 = 죽음
// 사본의 작은따옴표 문자열 안으로 들어가므로 백슬래시를 한 겹 더 입힌다.
const FLAG_REGION = `node -e "console.log(\\\\"REGION-OUTLIER: fixture.md 18 km from the Sai Kung centre\\\\"); process.exit(1)"`;

// 스크립트 사본을 임시 저장소(빈 posts 폴더 + fixture 1편)에서 돌린다. 진짜
// 검사기·수리기·번역기는 전부 가짜 명령으로 바꾼다 — 작은따옴표는 쓰지 않는다
// (스크립트의 명령 문자열이 작은따옴표라 사본이 SyntaxError 로 죽는다).
function runWith({ heldReason, region = NOOP, hours = NOOP }) {
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
    swap('node scripts/audit-region-outliers.mjs', region);
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
