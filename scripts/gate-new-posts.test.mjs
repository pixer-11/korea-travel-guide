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
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = join(process.cwd(), 'scripts', 'gate-new-posts.mjs');

// 검사기 하나를 지정한 명령으로 바꾼 사본을 임시 위치에서 돌린다.
function runWith(replacements) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  try {
    let src = readFileSync(SCRIPT, 'utf8');
    for (const [from, to] of replacements) src = src.split(from).join(to);
    // 사본이 임시 폴더에 있으니 상대 import 가 풀리지 않는다. 진짜 모듈을 절대
    // 경로로 가리킨다 — 그 모듈 위치에서 node_modules 해석이 살아난다.
    src = src.split("from './lib/frontmatter-edit.mjs'")
      .join('from ' + JSON.stringify(pathToFileURL(join(process.cwd(), 'scripts', 'lib', 'frontmatter-edit.mjs')).href));
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

t('구역 이상치 줄에서 파일을 지목한다', () => {
  // 09-02: 24편의 region 이 실제 구역과 달랐다. 검사기가 REGION-OUTLIER 를
  // 찍으면 게이트가 그 파일을 붙들어야 한다(--dry 라 heldReason 은 안 쓴다).
  // 작은따옴표 없는 가짜 명령: 게이트의 cmd 는 작은따옴표 문자열이라 안쪽에
  // 작은따옴표가 들어가면 사본이 SyntaxError 로 죽고, 그 스택트레이스에 파일명이
  // 찍혀 "지목했다"로 오판된다. 그래서 크래시가 아님도 함께 확인한다.
  const fake = `node -e "console.log(\\\\"REGION-OUTLIER: sai-kung-hong-kong-space-museum.md 18.2 km from the Sai Kung centre\\\\"); process.exit(1)"`;
  const r = runWith([['node scripts/audit-region-outliers.mjs', fake]]);
  if (/SyntaxError|GATE-CHECKER-CRASHED/.test(r.out)) return `게이트 사본이 죽음: ${r.out.slice(-300)}`;
  if (!/WOULD HOLD/.test(r.out)) return `붙들지 않음: ${r.out.slice(-300)}`;
  if (!/sai-kung-hong-kong-space-museum\.md/.test(r.out)) return `파일 미지목: ${r.out.slice(-300)}`;
  if (!/지역 태그/.test(r.out)) return `사유 미표기: ${r.out.slice(-300)}`;
  return null;
});

// ── 2026-09-24: 사진으로 풀리는 사유는 사진 순찰 몫, 알림은 사실대로 ──
// identity 검사의 여섯 결과가 한 문구로 묶여 전부 content(사람 몫)로 적혔고,
// content 는 사진 순찰이 건너뛴다. 새 사진 한 장이면 풀릴 글이 영영 갇혔는데
// 알림은 "자동 수리 순찰이 고친 뒤 다시 발행합니다" 라고 했다(seoul-san).
// 가짜 명령은 작은따옴표 없이 — 위 구역 이상치 테스트와 같은 이유.
const A = 'sai-kung-hong-kong-space-museum.md';      // 둘 다 공개 글이어야 한다(보류 글은 건너뛴다)
const B = 'chinatown-buddha-tooth-relic-temple.md';
const say = (...lines) => `node -e "${lines.map((l) => `console.log(\\\\"${l}\\\\")`).join('; ')}; process.exit(1)"`;
const IDENTITY = 'node scripts/audit-new-post-identity.mjs --since=HEAD';
const HUMAN = /기계가 고칠 수 없는 사유라 사람 확인이 필요합니다/;
// 나머지 검사기는 전부 조용한 빈 명령으로 — 그러지 않으면 진짜 검사기가 진짜 저장소를
// 돌려 찾은 결함이 섞여(09-24 첫 실행: 진짜 혼잡 주장 1편) 이 테스트가 저장소 상태에 흔들린다.
const QUIET = 'node -e "process.exit(0)"';
const ALL_CHECKS = ['node scripts/audit-hours-claims.mjs', 'node scripts/audit-hero-titles.mjs', IDENTITY,
  'node scripts/audit-crowd-claims.mjs', 'node scripts/audit-region-outliers.mjs', 'node scripts/validate-content.mjs'];
const only = (cmd, fake) => ALL_CHECKS.map((c) => [c, c === cmd ? fake : QUIET]);

t('다른 장소 사진은 사진 사유로 적고, 자동 수리를 약속한다', () => {
  const r = runWith(only(IDENTITY, say(`PHOTO-OTHER-VENUE ${A} Commons names another venue`)));
  if (/SyntaxError|GATE-CHECKER-CRASHED/.test(r.out)) return `게이트 사본이 죽음: ${r.out.slice(-300)}`;
  if (!/대표사진이 다른 장소·다른 때의 사진임/.test(r.out)) return `사진 사유로 안 적힘: ${r.out.slice(-300)}`;
  if (HUMAN.test(r.out)) return `사진으로 풀리는데 사람 몫이라 함: ${r.out.slice(-300)}`;
  if (!/자동 수리 순찰이 고친 뒤 다시 발행합니다/.test(r.out)) return `자동 수리 안내 없음: ${r.out.slice(-300)}`;
  return null;
});

t('장소가 없는 글은 사람 몫이라고 사실대로 말하고 글을 적는다', () => {
  const r = runWith(only(IDENTITY, say(`NO-VENUE-IDENTITY ${A} no place block`)));
  if (!/글이 특정 장소를 가리키지 않음/.test(r.out)) return `장소 사유로 안 적힘: ${r.out.slice(-300)}`;
  if (!HUMAN.test(r.out)) return `사람 몫인데 자동 수리를 약속함: ${r.out.slice(-300)}`;
  if (!new RegExp(`· ${A.replace(/\./g, '\\.')}`).test(r.out)) return `사람 확인 목록에 글이 없음: ${r.out.slice(-300)}`;
  if (/자동 수리 순찰이 고친 뒤/.test(r.out)) return `고칠 기계가 없는데 자동 수리 문구가 나옴: ${r.out.slice(-300)}`;
  return null;
});

t('사진도 틀리고 장소도 없으면 사람 몫이다 — 새 사진으로는 안 풀린다 (seoul-san 모양)', () => {
  const r = runWith(only(IDENTITY, say(`PHOTO-OTHER-VENUE ${A} other venue`, `NO-VENUE-IDENTITY ${A} no place block`)));
  return HUMAN.test(r.out) ? null : `장소 없는 글을 자동 수리 대상으로 봄: ${r.out.slice(-300)}`;
});

t('두 편이 섞이면 각각 따로 센다 — 1편 자동, 1편 사람', () => {
  const r = runWith(only(IDENTITY, say(`PHOTO-WRONG-PLACE ${A} wrong place`, `NO-VENUE-IDENTITY ${B} no place block`)));
  if (!/1편은 저장소에 남아 있어 자동 수리 순찰이/.test(r.out)) return `자동 1편 안내 없음: ${r.out.slice(-400)}`;
  if (!/1편은 기계가 고칠 수 없는 사유라/.test(r.out)) return `사람 1편 안내 없음: ${r.out.slice(-400)}`;
  if (new RegExp(`· ${A.replace(/\./g, '\\.')}`).test(r.out)) return `사진 글을 사람 목록에 넣음: ${r.out.slice(-400)}`;
  return null;
});

t('대표사진 검사(hero)도 사진 사유다 — 전엔 content 로 뭉쳐졌다', () => {
  const r = runWith(only('node scripts/audit-hero-titles.mjs', say(`vantage ${A} shows the skyline not the museum`)));
  if (!/대표사진이 그 장소를 보여주지 않음/.test(r.out)) return `hero 사유 없음: ${r.out.slice(-300)}`;
  return HUMAN.test(r.out) ? `사진으로 풀리는데 사람 몫이라 함: ${r.out.slice(-300)}` : null;
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
