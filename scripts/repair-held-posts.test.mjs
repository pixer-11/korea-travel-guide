// repair-held-posts 회귀 테스트 — 해제는 모든 격리 사유를 다시 검사해야 한다.
//
// 게이트는 `heldReason: hours+wrong-region` 처럼 사유를 전부 적는다. 그런데
// 이 순찰은 영업시간 감사만 다시 돌리고 해제했으므로, 영업시간 모순이 사라진
// 글의 잘못된 구역(region)이 그대로 발행됐다(코덱스 리뷰 2026-09-02).
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

// 스크립트 사본을 임시 저장소(빈 posts 폴더 + fixture 1편)에서 돌린다. 진짜
// 검사기·수리기·번역기는 전부 가짜 명령으로 바꾼다 — 작은따옴표는 쓰지 않는다
// (스크립트의 명령 문자열이 작은따옴표라 사본이 SyntaxError 로 죽는다).
function runWith({ regionOut }) {
  const root = mkdtempSync(join(tmpdir(), 'repair-held-'));
  const dir = join(root, 'src', 'content', 'posts');
  mkdirSync(dir, { recursive: true });
  const fixture = join(dir, 'fixture.md');
  writeFileSync(fixture, '---\ndraft: true\nheldReason: hours+wrong-region\ntitle: X\n---\nbody\n', 'utf8');
  try {
    let src = readFileSync(SCRIPT, 'utf8');
    const swap = (from, to) => {
      assert.ok(src.includes(from), `script no longer contains: ${from}`);
      src = src.split(from).join(to);
    };
    swap('node scripts/audit-hours-claims.mjs --drafts', NOOP);          // 영업시간은 치유됨
    swap('node scripts/audit-region-outliers.mjs', regionOut
      // 사본의 작은따옴표 문자열 안으로 들어가므로 백슬래시를 한 겹 더 입힌다.
      ? `node -e "console.log(\\\\"REGION-OUTLIER: fixture.md 18 km from the Sai Kung centre\\\\"); process.exit(1)"`
      : NOOP);
    src = src.replace(/node scripts\/fix-hours-claims\.mjs[^`']*/g, NOOP);
    src = src.replace(/node scripts\/translate-posts\.mjs[^`']*/g, NOOP);
    const p = join(root, 'repair.mjs');
    writeFileSync(p, src, 'utf8');
    let out;
    try { out = execFileSync(process.execPath, [p], { encoding: 'utf8', cwd: root }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    return { out, file: readFileSync(fixture, 'utf8') };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('영업시간은 풀렸어도 구역이 아직 어긋나면 해제하지 않는다', () => {
  const r = runWith({ regionOut: true });
  assert.ok(!/SyntaxError/.test(r.out), `사본이 죽음: ${r.out.slice(-300)}`);
  assert.match(r.file, /^draft: true$/m, `해제됨:\n${r.out}`);
  assert.match(r.file, /^heldReason: hours\+wrong-region$/m);
  assert.match(r.out, /구역\(region\)이 여전히 어긋남/);
  assert.match(r.out, /REPAIRED 0 of 1/);
});

test('두 사유가 모두 풀리면 해제한다', () => {
  const r = runWith({ regionOut: false });
  assert.ok(!/SyntaxError/.test(r.out), `사본이 죽음: ${r.out.slice(-300)}`);
  assert.match(r.file, /^draft: false$/m, `해제 안 됨:\n${r.out}`);
  assert.ok(!/^heldReason:/m.test(r.file), 'heldReason 이 남아 있음');
  assert.match(r.out, /REPAIRED 1 of 1/);
});
