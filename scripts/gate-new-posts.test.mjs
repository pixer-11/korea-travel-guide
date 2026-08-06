// gate-new-posts 회귀 테스트.
//
// 이 게이트는 결함 있는 글이 사이트에 올라가기 전 마지막 관문이다. 그런데
// 2026-08-05까지 검사기가 크래시하면 그 결과를 "지적 없음"과 똑같이 취급해서,
// 게이트가 통째로 죽어 있어도 "✓ 모든 글이 통과했습니다"를 찍고 정상 종료했다.
// 두 호출부 모두 continue-on-error 라 아무도 알아채지 못한다.
//
//   node scripts/gate-new-posts.test.mjs
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'gate-new-posts.mjs');

// 검사기 하나를 지정한 명령으로 바꾼 사본을 임시 위치에서 돌린다.
function runWith(replacements) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  try {
    let src = readFileSync(SCRIPT, 'utf8');
    for (const [from, to] of replacements) src = src.split(from).join(to);
    const p = join(dir, 'gate.mjs');
    writeFileSync(p, src, 'utf8');
    try {
      return { code: 0, out: execFileSync(process.execPath, [p, '--dry'], { encoding: 'utf8', cwd: process.cwd() }) };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('검사기가 죽으면 통과로 처리하지 않는다', () => {
  const r = runWith([['node scripts/audit-hours-claims.mjs', 'node scripts/does-not-exist-xyz.mjs']]);
  if (!/GATE-CHECKER-CRASHED/.test(r.out)) return `크래시를 보고하지 않음: ${r.out.slice(-200)}`;
  if (r.code === 0) return '크래시인데 exit 0 으로 끝남';
  if (/every post.*passed the publish gate/.test(r.out)) return '크래시인데 "통과" 문구를 출력함';
  return null;
});

t('검사기 여러 개가 죽으면 개수를 보고한다', () => {
  const r = runWith([
    ['node scripts/audit-hours-claims.mjs', 'node scripts/nope-a.mjs'],
    ['node scripts/audit-hero-titles.mjs', 'node scripts/nope-b.mjs'],
  ]);
  return /GATE-CHECKER-CRASHED: 2 of/.test(r.out) ? null : `개수 보고 안 함: ${r.out.slice(-200)}`;
});

t('정상일 때는 통과 문구와 exit 0', () => {
  const r = runWith([]);
  if (r.code !== 0) return `정상인데 exit ${r.code}: ${r.out.slice(-200)}`;
  if (/GATE-CHECKER-CRASHED/.test(r.out)) return '정상인데 크래시로 보고함';
  return null;
});

t('지적을 내며 exit 1 하는 검사기는 크래시가 아니다', () => {
  // 실제 검사기들은 결함을 찾으면 stdout 에 찍고 exit 1 한다 — 이걸 크래시로
  // 오인하면 매일 거짓 경보가 울리고, 그러면 사람이 경보를 무시하게 된다.
  const fake = process.platform === 'win32'
    ? `node -e "console.log('HOURS-CONTRADICTION: nonexistent-post.md'); process.exit(1)"`
    : `node -e "console.log('HOURS-CONTRADICTION: nonexistent-post.md'); process.exit(1)"`;
  const r = runWith([['node scripts/audit-hours-claims.mjs', fake]]);
  return /GATE-CHECKER-CRASHED/.test(r.out) ? `오탐: ${r.out.slice(-200)}` : null;
});

t('중복 이벤트 줄에서 두 파일을 모두 지목한다', () => {
  // 이 줄은 쌍의 양쪽을 적는데, 새로 발견된 쪽은 항상 두 번째다. 첫 번째만
  // 뽑던 동안에는 이미 살아 있던 옛 글(= --since 범위 밖)이 지목되어 게이트가
  // 아무것도 막지 못했고, 그렇게 자카르타 위켄드 공연이 두 번 올라갔다.
  const fake = `node -e "console.log('  • DUPLICATE event coverage (weeknd): first-post.md, second-post.md'); process.exit(1)"`;
  const r = runWith([['node scripts/validate-content.mjs', fake]]);
  if (!/first-post\.md/.test(r.out)) return `첫 번째 파일 누락: ${r.out.slice(-300)}`;
  if (!/second-post\.md/.test(r.out)) return `두 번째 파일 누락 — 새 글이 그대로 발행된다: ${r.out.slice(-300)}`;
  return null;
});

t('날짜가 어긋난 쌍도 두 파일 모두 지목한다', () => {
  const fake = `node -e "console.log('  • CONTRADICTORY event dates (motogp, 2026-09-01~2026-09-02 vs 2026-09-05~2026-09-06): aa.md, bb.md'); process.exit(1)"`;
  const r = runWith([['node scripts/validate-content.mjs', fake]]);
  return /aa\.md/.test(r.out) && /bb\.md/.test(r.out) ? null : `두 파일 모두 지목하지 않음: ${r.out.slice(-300)}`;
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
