// places-budget 회귀 테스트.
//
// 이 배분이 조용히 틀어지면 폐업 감지가 다시 굶는다 — 2026-08-05 기준으로
// 536편 중 535편이 한 번도 재검사되지 않은 상태였고, 원인은 앞선 작업들이
// 하루치 100회를 다 써버린 것이었다. 그래서 "몫", "남은 것 물려주기", "바닥나면
// 0" 세 가지를 고정한다.
//
//   node scripts/lib/places-budget.test.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// 원장 파일 경로가 모듈에 고정돼 있으므로, 임시 저장소를 만들어 그 안에서 돌린다.
function inSandbox(script) {
  const dir = mkdtempSync(join(tmpdir(), 'placesbudget-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
    const src = new URL('./places-budget.mjs', import.meta.url);
    writeFileSync(join(dir, 'scripts', 'lib', 'places-budget.mjs'), execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(src.pathname.replace(/^\//, ''))}, 'utf8'))`], { encoding: 'utf8' }));
    writeFileSync(join(dir, 'run.mjs'), script);
    return execFileSync(process.execPath, ['run.mjs'], { cwd: dir, encoding: 'utf8' }).trim();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const cases = [];
const t = (name, script, expect) => cases.push([name, script, expect]);

t('각 작업은 자기 몫으로 시작한다', `
import { claim } from './scripts/lib/places-budget.mjs';
const p = await claim('publish'), r = await claim('refresh');
console.log(p.allowance + ',' + r.allowance);
`, '40,20');

t('앞 작업이 적게 쓰면 남은 몫이 뒤로 넘어간다', `
import { claim, record } from './scripts/lib/places-budget.mjs';
await record('publish', 5);            // 40 중 5만 사용
const r = await claim('refresh');       // 자기 몫 20, 남은 총량 95 → 20
console.log(r.allowance + ',' + r.spentToday);
`, '20,5');

t('하루 총량이 바닥나면 0을 준다', `
import { claim, record } from './scripts/lib/places-budget.mjs';
await record('publish', 100);
const r = await claim('refresh');
console.log(r.allowance + ',' + r.remainingToday);
`, '0,0');

t('한 작업이 자기 몫을 다 쓰면 더 받지 못한다', `
import { claim, record } from './scripts/lib/places-budget.mjs';
await record('refresh', 20);
const r = await claim('refresh');
console.log(String(r.allowance));
`, '0');

t('몫 합계가 하루 한도와 같다', `
import { SHARES, DAILY_CAP } from './scripts/lib/places-budget.mjs';
console.log(String(Object.values(SHARES).reduce((a, b) => a + b, 0) === DAILY_CAP));
`, 'true');

t('모르는 작업 이름은 거부한다', `
import { claim } from './scripts/lib/places-budget.mjs';
try { await claim('nope'); console.log('accepted'); } catch { console.log('rejected'); }
`, 'rejected');

let fail = 0;
for (const [name, script, expect] of cases) {
  let got;
  try { got = inSandbox(script); } catch (e) { got = `threw: ${String(e.message).split('\n')[0]}`; }
  const ok = got === expect;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(expect)}`}`);
  if (!ok) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
