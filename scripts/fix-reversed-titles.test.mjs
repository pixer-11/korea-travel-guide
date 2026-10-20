// 저장소 전체 검사: 도시가 콜론 앞에 온 번역 제목이 하나도 없어야 한다(2026-10-20, 57건 수리).
// 번역기가 쓸 때 돌려놓지만, 손으로 고친 제목이나 옛 경로로 들어온 것까지 CI 에서 막는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('🛑 도시가 앞에 온 번역 제목이 없다', () => {
  const out = execFileSync(process.execPath, ['scripts/fix-reversed-titles.mjs'], { encoding: 'utf8' });
  const n = Number((out.match(/(\d+) title\(s\)/) || [])[1]);
  assert.equal(n, 0, `${n}개 제목이 뒤집혀 있다 — node scripts/fix-reversed-titles.mjs --write\n${out.slice(0, 2000)}`);
});
