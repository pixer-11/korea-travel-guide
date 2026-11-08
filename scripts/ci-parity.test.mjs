// `npm run ci` 가 GitHub 의 Tests 워크플로와 같은 것을 돌리는가.
//
// 🛑 2026-09-13: 안 그랬다. 로컬 ci 는 세 단계가 빠져 있었다 —
// lint-undeclared, check-writer-safety, audit-checkers. 그래서 나는
// "1,197건 통과"를 보고 푸시했고, GitHub 은 27초 만에 빨간불을 켰다.
// 떨어뜨린 것은 내 코드가 아니라 자동 발행이 만든 글 한 편이었는데
// (본문이 `---` 로 시작 → 다시 써내면 본문이 프런트매터로 먹힌다),
// 로컬에는 그걸 보는 검사가 아예 없었으니 알 길이 없었다.
//
// 메모리의 "커밋 전엔 npm test 말고 npm run ci" 규칙은 그 ci 가 CI 와
// 같을 때만 유효하다. 그래서 그 전제를 여기서 강제한다.
//
// 방향은 한쪽이다: 워크플로가 돌리는 검사는 전부 `npm run ci` 에 있어야
// 한다. 반대는 자유 — ci 가 더 많이 도는 것은 안전한 쪽이다.
//   node --test scripts/ci-parity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const ci = String(pkg.scripts?.ci ?? '');
const wf = readFileSync('.github/workflows/tests.yml', 'utf8');

// `run: node scripts/<name>.mjs` 한 줄짜리 호출만 본다. 여러 줄 블록이나
// 셸 조건이 붙은 것은 로컬에서 그대로 재현할 수 없으므로 대상이 아니다.
const wfScripts = [...wf.matchAll(/^\s*run:\s*node (scripts\/[\w-]+\.mjs)\s*$/gm)].map((m) => m[1]);

test('워크플로가 한 줄로 돌리는 검사는 전부 npm run ci 에도 있다', () => {
  assert.ok(wfScripts.length >= 3, `워크플로에서 찾은 검사가 ${wfScripts.length}개뿐 — 패턴이 안 맞는 것 아닌가`);
  const missing = wfScripts.filter((s) => !ci.includes(s));
  assert.deepEqual(
    missing, [],
    `npm run ci 에 빠진 검사: ${missing.join(', ')}\n` +
    '로컬이 통과해도 GitHub 이 떨어뜨린다. package.json 의 ci 에 추가할 것.',
  );
});

test('ci 는 타입 검사와 테스트도 돌린다', () => {
  assert.match(ci, /astro check/, 'astro check 가 빠졌다');
  assert.match(ci, /node --test/, 'node --test 가 빠졌다');
});

test('ci 는 && 로 이어져 한 단계라도 실패하면 멈춘다', () => {
  // `;` 로 이으면 앞 단계가 실패해도 마지막 종료코드만 남아 초록이 된다.
  assert.ok(!/;\s*(node|astro)/.test(ci), 'ci 단계를 ; 로 이으면 실패가 묻힌다 — && 를 쓸 것');
});

// 🛑 2026-11-08: 위와 반대 방향의 구멍. `node --test` 는 전부 돌지만 GitHub 의 Tests 는
// 손으로 적은 폴더 목록만 돌아서, src/i18n 12개와 src/styles 1개는 로컬에서만 돌았다.
// 08-06 에 scripts/lib·worker 로 이미 한 번 겪은 일이라 이번엔 목록 자체를 없앴다.
const tracked = execFileSync('git', ['ls-files', '*.test.mjs'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const triggers = yaml.load(wf).on;

test('GitHub Tests 는 손으로 적은 목록이 아니라 git 이 아는 테스트 전부를 돈다', () => {
  assert.ok(tracked.length >= 200, `git 이 알려 준 테스트가 ${tracked.length}개뿐 — 조회가 잘못된 것 아닌가`);
  assert.equal(wf.match(/^\s*for t in (.+); do\s*$/m)?.[1], "$(git ls-files '*.test.mjs')");
});

test('테스트를 하나도 못 찾았으면 통과가 아니다', () => {
  assert.match(wf, /if \[ "\$ran" -eq 0 \]; then[\s\S]*?exit 1/);
});

test('테스트가 있는 폴더는 push·PR 트리거가 모두 지켜본다', () => {
  for (const event of ['push', 'pull_request']) {
    const watched = triggers[event].paths.filter((p) => p.endsWith('/**')).map((p) => p.slice(0, -2));
    assert.ok(watched.length >= 5, `${event} 트리거에서 찾은 폴더가 ${watched.length}개뿐 — 패턴이 안 맞는 것 아닌가`);
    const orphans = tracked.filter((f) => !watched.some((dir) => f.startsWith(dir)));
    assert.deepEqual(orphans, [], `${event} 트리거 밖의 테스트 — 그 폴더만 고친 커밋은 Tests 가 안 돈다`);
  }
});
