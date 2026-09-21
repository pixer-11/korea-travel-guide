// rebase 뒤 프론트매터 관문의 네 갈래를 실제 git 저장소로 확인한다 (2026-09-21).
//
// 왜 있나. 09-17 에 걸어둔 이 관문이 09-21 아침에 gsc-report 와 performance-log 를
// 세웠다. 이유는 프론트매터가 아니었다 — 그 두 잡은 data/*.json 만 커밋하는
// 가벼운 잡이라 npm ci 를 돌리지 않고, 검사기는 gray-matter 를 import 하므로
// ERR_MODULE_NOT_FOUND 로 죽었다. 관문은 그 비-0 을 "깨졌다"로 읽었다.
// 즉 **한 글자도 보지 못한 것을 판정으로 적었다.**
//
// 관문이 셸 안에 있으면 테스트가 없기 쉽고, 그래서 이렇게 실패한다. 네 갈래를
// 전부 고정한다: 건너뛰어야 할 때 건너뛰고, 막아야 할 때 막고, 못 쟀을 때는
// "깨졌다"가 아니라 "못 쟀다"라고 말한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SH = readFileSync(join(REPO, 'scripts', 'git-push-retry.sh'), 'utf8');
// 스크립트를 통째로 source 하면 맨 아래 푸시 루프가 돈다 — 함수만 떼어 쓴다.
const FN = SH.split('\n').slice(
  SH.split('\n').findIndex((l) => l.startsWith('frontmatter_ok_to_push()')),
).join('\n').split('\n}')[0] + '\n}';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });

/** origin 을 가진 작은 저장소 하나. commit() 으로 파일을 얹는다. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'wa-push-guard-'));
  const bare = join(dir, 'origin.git');
  const work = join(dir, 'work');
  mkdirSync(bare); mkdirSync(work);
  git(bare, 'init', '--bare', '-b', 'main');
  git(work, 'init', '-b', 'main');
  git(work, 'config', 'user.email', 't@t'); git(work, 'config', 'user.name', 't');
  mkdirSync(join(work, 'scripts'), { recursive: true });
  writeFileSync(join(work, 'seed.txt'), 'seed\n');
  git(work, 'add', '-A'); git(work, 'commit', '-m', 'seed');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-u', 'origin', 'main');
  return { dir, work };
}

function commit(work, path, body = 'x\n') {
  mkdirSync(join(work, path.split('/').slice(0, -1).join('/')), { recursive: true });
  writeFileSync(join(work, path), body);
  git(work, 'add', '-A'); git(work, 'commit', '-m', `add ${path}`);
}

/** 관문을 그 저장소에서 돌린다. */
const runGuard = (work) => {
  const r = spawnSync('bash', ['-c', `set -uo pipefail\nBRANCH=main\n${FN}\nfrontmatter_ok_to_push`], { cwd: work, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

const stubAudit = (work, exitCode) =>
  writeFileSync(join(work, 'scripts', 'audit-frontmatter-parse.mjs'), `process.exit(${exitCode});\n`);

test('data 파일만 미는 푸시는 프론트매터 검사를 건너뛴다 — 09-21 에 여섯 잡을 세운 갈래', () => {
  const { dir, work } = repo();
  try {
    stubAudit(work, 1); // 검사기가 실패하도록 해둬도
    commit(work, 'data/gsc-page-performance.json', '{}\n');
    const r = runGuard(work);
    assert.equal(r.code, 0, r.out); // 건너뛰므로 통과해야 한다
    assert.match(r.out, /건너뜀/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('콘텐츠를 건드리는데 검사기를 못 돌리면 "깨졌다"가 아니라 "못 쟀다"로 막는다', () => {
  const { dir, work } = repo();
  try {
    stubAudit(work, 0); // 검사기 자체는 멀쩡해도 node_modules 가 없으면
    commit(work, 'src/content/posts/a.md', '---\ntitle: A\n---\n\nbody\n');
    const r = runGuard(work);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /실행할 수 없다/);
    assert.doesNotMatch(r.out, /깨졌다/, '재지도 못하고 깨졌다고 말하면 09-21 과 같은 오진이다');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('콘텐츠를 건드리고 검사기가 통과하면 민다', () => {
  const { dir, work } = repo();
  try {
    stubAudit(work, 0);
    mkdirSync(join(work, 'node_modules', 'gray-matter'), { recursive: true });
    commit(work, 'src/content/posts/a.md', '---\ntitle: A\n---\n\nbody\n');
    const r = runGuard(work);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('콘텐츠를 건드리고 프론트매터가 진짜 깨졌으면 막는다 — 09-17 사고의 갈래', () => {
  const { dir, work } = repo();
  try {
    stubAudit(work, 1);
    mkdirSync(join(work, 'node_modules', 'gray-matter'), { recursive: true });
    commit(work, 'src/content/posts/a.md', '---\ntitle: A\ntitle: A\n---\n\nbody\n');
    const r = runGuard(work);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /깨졌다/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
