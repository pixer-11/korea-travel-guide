// check-writer-safety 회귀 테스트.
//
// 이 검사는 "수리 도구가 이 글을 다시 써도 살아남는가"를 묻는다. 조용히 통과하면
// 본문이 사라지는 글이 태어나도 아무도 모른다.
//
//   node --test scripts/check-writer-safety.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'check-writer-safety.mjs');

function run(files) {
  const root = mkdtempSync(join(tmpdir(), 'writer-safety-'));
  try {
    mkdirSync(join(root, 'src', 'content', 'posts'), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(root, 'src', 'content', 'posts', name), body, 'utf8');
    }
    try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' }) }; }
    catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const ok = '---\ntitle: A place\ndraft: false\n---\nA body with plenty of words in it so the threshold has something to measure against.\n';

test('평범한 글은 통과한다', () => {
  assert.equal(run({ 'a.md': ok }).code, 0);
});

test('본문이 --- 로 시작하면 잡는다 — 다시 써내면 삼켜진다', () => {
  const r = run({ 'a.md': ok, 'b.md': '---\ntitle: B\n---\n---\nthis body starts with a rule and would be eaten whole on the next rewrite.\n' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /WRITER-UNSAFE/);
  assert.match(r.out, /본문이/);
});

test('본문 일부만 삼켜져도 잡는다 — 10% 문턱은 첫 문단 하나를 놓쳤다 (2026-09-09 리뷰)', () => {
  const filler = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const r = run({ 'a.md': ok, 'c.md': `---\ntitle: C\n---\n---\n# Do not enter the unstable tunnel.\n---\n${filler}\n` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /c\.md/);
});

test('글이 하나도 없으면 통과를 보고하지 않는다', () => {
  const r = run({});
  assert.equal(r.code, 1);
  assert.match(r.out, /NOTHING-EXAMINED/);
});
