// lint-undeclared 회귀 테스트.
//
// 이 검사기는 "우리 lib 이 내보낸 이름을 import 없이 쓰는 곳"을 찾는다. 오탐이
// 하나라도 있으면 사람이 검사를 끄게 되고, 놓치는 게 있으면 있으나 마나다.
// 아래 케이스는 전부 코덱스 리뷰(2026-09-08)가 실제로 재현해 보인 것들이다.
//
//   node --test scripts/lint-undeclared.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'lint-undeclared.mjs');

// scripts/lib 에 아주 작은 모듈 하나만 둔 저장소에서 돌린다 — 진짜 저장소를
// 스캔하면 이 테스트가 다른 파일의 상태에 흔들린다.
function lint(files, libSrc = 'export function probeHelper() { return 1; }\n') {
  const root = mkdtempSync(join(tmpdir(), 'undeclared-'));
  try {
    mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'lib', 'probe-lib.mjs'), libSrc, 'utf8');
    cpSync(join(process.cwd(), 'scripts', 'lib', 'examined.mjs'), join(root, 'scripts', 'lib', 'examined.mjs'));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(root, 'scripts', name), body, 'utf8');
    // node_modules(acorn)는 진짜 저장소 것을 쓰도록 스크립트는 원래 자리에서 돌리고
    // cwd 만 옮긴다.
    try {
      return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' }) };
    } catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('import 없이 부르면 잡는다', () => {
  const r = lint({ 'probe.mjs': 'probeHelper();\n' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /UNDECLARED/);
});

test('import 하면 잡지 않는다', () => {
  const r = lint({ 'probe.mjs': "import { probeHelper } from './lib/probe-lib.mjs';\nprobeHelper();\n" });
  assert.equal(r.code, 0, r.out);
});

test('객체 리터럴 축약 { probeHelper } 는 선언이 아니라 사용이다', () => {
  const r = lint({ 'probe.mjs': 'const payload = { probeHelper };\nconsole.log(payload);\n' });
  assert.equal(r.code, 1, `축약을 선언으로 읽어 놓쳤다:\n${r.out}`);
});

test('클래스 메서드 이름은 변수가 아니다', () => {
  const r = lint({ 'probe.mjs': 'class A { probeHelper() {} }\nnew A();\n' });
  assert.equal(r.code, 0, `오탐:\n${r.out}`);
});

test('클래스 필드 이름도 변수가 아니다', () => {
  const r = lint({ 'probe.mjs': 'class A { probeHelper = 1; }\nnew A();\n' });
  assert.equal(r.code, 0, `오탐:\n${r.out}`);
});

test('이름 붙은 클래스 표현식은 그 이름을 선언한다', () => {
  const r = lint({ 'probe.mjs': 'const A = class probeHelper {};\nconsole.log(A);\n' });
  assert.equal(r.code, 0, `오탐:\n${r.out}`);
});

test('재수출(export { x as y } from …)의 x 는 이 파일의 변수가 아니다', () => {
  const r = lint({ 'probe.mjs': "export { probeHelper as helper } from './lib/probe-lib.mjs';\n" });
  assert.equal(r.code, 0, `오탐:\n${r.out}`);
});

test('라벨은 변수가 아니다', () => {
  const r = lint({ 'probe.mjs': 'probeHelper: while (true) { break probeHelper; }\n' });
  assert.equal(r.code, 0, `오탐:\n${r.out}`);
});

test('export { name } 목록으로 내보낸 이름도 추적한다', () => {
  const r = lint(
    { 'probe.mjs': 'listExported();\n' },
    'const listExported = () => 1;\nexport { listExported };\n',
  );
  assert.equal(r.code, 1, `목록형 export 를 못 봤다:\n${r.out}`);
});

test('파싱 못 하는 파일이 있으면 조용히 넘어가지 않는다', () => {
  const r = lint({ 'probe.mjs': 'const = = ;\n' });
  assert.equal(r.code, 1);
  assert.match(r.out, /UNPARSABLE/);
});
