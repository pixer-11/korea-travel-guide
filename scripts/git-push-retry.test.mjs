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

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
