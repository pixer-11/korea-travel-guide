// git-push-retry 회귀 테스트.
//
// 이 스크립트는 발행·순찰 등 19개 워크플로의 마지막 단계다. 여기서 실패하면
// 그 실행이 만든 결과물(격리·번역·생성물)이 통째로 버려지고, 유료 호출도 함께
// 사라진다. 2026-08-04에 실제로 그렇게 실패했다 — 원격과 충돌한 것이 아니라
// 작업 트리에 스테이징되지 않은 파일이 하나 있었을 뿐인데, rebase 가 시작을
// 거부하고 5회가 전부 헛돌았다. 워크플로들은 생성물 경로만 골라 스테이징하므로
// 그 상태는 예외가 아니라 평범하다.
//
// 진짜 저장소 두 개(원격 역할 bare + 클론)를 임시로 만들어 검증한다.
//
//   node scripts/git-push-retry.test.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'git-push-retry.sh');

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function makeRepos() {
  const root = mkdtempSync(join(tmpdir(), 'pushretry-'));
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  mkdirSync(remote); mkdirSync(work);
  git(remote, 'init', '--bare', '--initial-branch=main');
  git(work, 'init', '--initial-branch=main');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'remote', 'add', 'origin', remote);
  writeFileSync(join(work, 'seed.txt'), 'seed\n');
  git(work, 'add', '.');
  git(work, 'commit', '-m', 'seed');
  git(work, 'push', 'origin', 'main');
  return { root, remote, work };
}

// 원격에 다른 커밋을 하나 얹는다(다른 봇이 먼저 푸시한 상황).
function pushFromElsewhere({ remote, root }, name) {
  const other = join(root, `other-${name}`);
  mkdirSync(other);
  git(other, 'clone', remote, '.');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'config', 'user.name', 'Other');
  writeFileSync(join(other, `${name}.txt`), 'from elsewhere\n');
  git(other, 'add', '.');
  git(other, 'commit', '-m', `other ${name}`);
  git(other, 'push', 'origin', 'main');
}

const runScript = (cwd) => {
  try {
    const out = execFileSync('bash', [SCRIPT], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('깨끗한 트리에서 푸시된다', () => {
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'a.txt'), 'a\n');
    git(r.work, 'add', '.'); git(r.work, 'commit', '-m', 'mine');
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    return git(r.work, 'log', '--oneline', 'origin/main').includes('mine') ? null : '원격에 반영되지 않음';
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('스테이징되지 않은 파일이 있어도 푸시된다', () => {
  // 08-04에 실패한 바로 그 상태. 워크플로가 생성물 경로만 add 했을 때 남는 모습.
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'a.txt'), 'a\n');
    git(r.work, 'add', 'a.txt'); git(r.work, 'commit', '-m', 'mine');
    writeFileSync(join(r.work, 'seed.txt'), 'locally edited, never staged\n');
    const res = runScript(r.work);
    if (!res.ok) return `실패(08-04 회귀): ${res.out}`;
    return git(r.work, 'log', '--oneline', 'origin/main').includes('mine') ? null : '원격에 반영되지 않음';
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('스테이징 안 된 변경은 푸시 뒤에도 남아 있다', () => {
  // autostash 가 되돌려놓지 않으면 작업 내용이 조용히 사라진다.
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'a.txt'), 'a\n');
    git(r.work, 'add', 'a.txt'); git(r.work, 'commit', '-m', 'mine');
    writeFileSync(join(r.work, 'seed.txt'), 'KEEP ME\n');
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    const status = git(r.work, 'status', '--porcelain');
    return status.includes('seed.txt') ? null : `작업 내용이 사라짐 — status: ${JSON.stringify(status)}`;
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('다른 봇이 먼저 푸시했어도 그 위에 얹는다', () => {
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'a.txt'), 'a\n');
    git(r.work, 'add', '.'); git(r.work, 'commit', '-m', 'mine');
    pushFromElsewhere(r, 'bot');
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    const log = git(r.work, 'log', '--oneline', 'origin/main');
    return log.includes('mine') && log.includes('other bot') ? null : `두 커밋이 모두 남지 않음: ${log}`;
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

// 원격에 임의 변경을 얹는 일반형 — 수정·삭제·복수 파일 시나리오용.
function pushFromElsewhereWith({ remote, root }, name, mutate) {
  const other = join(root, `other-${name}`);
  mkdirSync(other);
  git(other, 'clone', remote, '.');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'config', 'user.name', 'Other');
  mutate(other);
  git(other, 'add', '-A');
  git(other, 'commit', '-m', `other ${name}`);
  git(other, 'push', 'origin', 'main');
}

t('같은 줄을 양쪽이 고치면 원격이 이긴다 (주석의 약속 그대로)', () => {
  // 2026-08-27 코덱스 감사: rebase 에서는 ours/theirs 가 뒤집혀 -X theirs 가
  // 로컬을 이기게 했다 — 주석("원격을 존중")과 정반대. 원격의 편집이 남아야 한다.
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'seed.txt'), 'local version\n');
    writeFileSync(join(r.work, 'mine.txt'), 'mine\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'mine');
    pushFromElsewhereWith(r, 'edit', (d) => writeFileSync(join(d, 'seed.txt'), 'remote version\n'));
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    const remoteSeed = git(r.work, 'show', 'origin/main:seed.txt');
    if (remoteSeed !== 'remote version\n') return `원격 편집이 사라짐 — seed.txt: ${JSON.stringify(remoteSeed)}`;
    return git(r.work, 'ls-tree', '--name-only', 'origin/main').includes('mine.txt') ? null : '우리 새 파일이 사라짐';
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('로컬이 지운 파일을 원격이 고쳤으면 파일이 남는다 (kas-kas 회귀)', () => {
  const r = makeRepos();
  try {
    git(r.work, 'rm', '-q', 'seed.txt');
    writeFileSync(join(r.work, 'mine.txt'), 'mine\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'mine deletes seed');
    pushFromElsewhereWith(r, 'edit', (d) => writeFileSync(join(d, 'seed.txt'), 'remote edited\n'));
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    const remoteSeed = git(r.work, 'show', 'origin/main:seed.txt');
    if (remoteSeed !== 'remote edited\n') return `원격 수정본이 남지 않음: ${JSON.stringify(remoteSeed)}`;
    return git(r.work, 'ls-tree', '--name-only', 'origin/main').includes('mine.txt') ? null : '우리 새 파일이 사라짐';
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('원격이 지운 파일을 로컬이 고쳤으면 삭제가 유지된다', () => {
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'seed.txt'), 'local edit\n');
    writeFileSync(join(r.work, 'mine.txt'), 'mine\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'mine edits seed');
    pushFromElsewhereWith(r, 'del', (d) => rmSync(join(d, 'seed.txt')));
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    const tree = git(r.work, 'ls-tree', '--name-only', 'origin/main');
    if (tree.includes('seed.txt')) return '원격의 삭제가 무시됨';
    return tree.includes('mine.txt') ? null : '우리 새 파일이 사라짐';
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('충돌이 커밋 두 개에 걸쳐 있어도 전부 풀고 푸시한다', () => {
  // 2026-08-27 코덱스 감사: --continue 를 한 번만 불러 두 번째 멈춤에서 전체를
  // abort 했고, 5회 재시도가 전부 같은 지점에서 헛돌았다.
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'b.txt'), 'b\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'base b'); git(r.work, 'push', 'origin', 'main');
    git(r.work, 'rm', '-q', 'seed.txt');
    writeFileSync(join(r.work, 'm1.txt'), 'm1\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'del seed');
    git(r.work, 'rm', '-q', 'b.txt');
    writeFileSync(join(r.work, 'm2.txt'), 'm2\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'del b');
    pushFromElsewhereWith(r, 'edits', (d) => {
      writeFileSync(join(d, 'seed.txt'), 'remote seed\n');
      writeFileSync(join(d, 'b.txt'), 'remote b\n');
    });
    const res = runScript(r.work);
    if (!res.ok) return `실패(두 번째 멈춤에서 포기): ${res.out}`;
    const tree = git(r.work, 'ls-tree', '--name-only', 'origin/main');
    for (const f of ['seed.txt', 'b.txt', 'm1.txt', 'm2.txt']) {
      if (!tree.includes(f)) return `${f} 가 원격에 없음 (tree: ${tree.replace(/\n/g, ' ')})`;
    }
    return null;
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

t('충돌 해소로 커밋이 텅 비면 건너뛰고 계속한다', () => {
  // 로컬 커밋의 유일한 변경이 원격-우선으로 사라지면 rebase 가 "빈 커밋"으로
  // 멈춘다 — abort 가 아니라 skip 하고 나머지를 밀어야 한다.
  const r = makeRepos();
  try {
    writeFileSync(join(r.work, 'seed.txt'), 'only local change\n');
    git(r.work, 'add', '-A'); git(r.work, 'commit', '-m', 'only conflicting change');
    pushFromElsewhereWith(r, 'edit', (d) => writeFileSync(join(d, 'seed.txt'), 'remote wins\n'));
    const res = runScript(r.work);
    if (!res.ok) return `실패: ${res.out}`;
    const remoteSeed = git(r.work, 'show', 'origin/main:seed.txt');
    return remoteSeed === 'remote wins\n' ? null : `원격 내용이 아님: ${JSON.stringify(remoteSeed)}`;
  } finally { rmSync(r.root, { recursive: true, force: true }); }
});

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
