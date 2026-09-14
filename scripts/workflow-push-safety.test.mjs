// 워크플로가 main 에 커밋하는 방식은 하나여야 한다.
//
// 2026-09-14: gsc-report 가 제 일을 전부 마친 뒤 `git pull --rebase origin main`
// 한 줄에서 죽었다 — 같은 잡의 다른 스크립트가 쓴 파일이 unstaged 로 남아 있어
// rebase 가 시작조차 거부한 것이다. 이미 2026-08-04 에 같은 부류를 겪고
// `scripts/git-push-retry.sh` 를 만들었는데(그 파일 머리말이 이 함정을 그대로
// 적어 두었다), 워크플로 몇 개가 옛 방식으로 남아 있었다.
//
// 규칙: `git pull --rebase` 를 직접 쓰려면 --autostash 가 있어야 한다.
// 없으면 공용 헬퍼를 쓴다. 둘 다 아니면 이 테스트가 막는다.
//
//   node --test scripts/workflow-push-safety.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 규칙 하나를 함수로 둔다 — 진짜 워크플로에도 걸고 가짜 예시에도 걸어
// "막히는가" 와 "정상까지 막진 않는가" 를 둘 다 잰다.
export function offendingLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (/^\s*#/.test(line)) continue; // 주석은 명령이 아니다
    if (!/git\s+pull\s+--rebase/.test(line)) continue;
    if (/--autostash/.test(line)) continue;
    out.push(line.trim());
  }
  return out;
}

const DIR = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

test('워크플로 폴더를 실제로 읽었다 (빈 통과 금지)', () => {
  assert.ok(files.length > 10, `워크플로를 ${files.length}개만 읽었다 — 경로가 틀렸다`);
});

test('git pull --rebase 를 직접 쓰는 워크플로에는 --autostash 가 있다', () => {
  const offenders = [];
  for (const f of files) {
    for (const line of offendingLines(readFileSync(join(DIR, f), 'utf8'))) offenders.push(`${f}: ${line}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `unstaged 파일 하나면 rebase 가 시작도 못 한다. --autostash 를 붙이거나 bash scripts/git-push-retry.sh 를 쓸 것:\n  ${offenders.join('\n  ')}`,
  );
});

test('규칙 자체를 양방향으로 잰다', () => {
  assert.deepEqual(offendingLines('          git pull --rebase --autostash origin main'), []);
  assert.deepEqual(offendingLines('          bash scripts/git-push-retry.sh'), []);
  assert.deepEqual(offendingLines('          # git pull --rebase 는 이런 함정이 있다'), []);
  assert.deepEqual(offendingLines('          git pull --rebase origin main'), ['git pull --rebase origin main']);
});

test('공용 헬퍼는 실제로 그 자리에 있다', () => {
  assert.match(readFileSync(join(process.cwd(), 'scripts', 'git-push-retry.sh'), 'utf8'), /--autostash/);
});
