// ─────────────────────────────────────────────────────────────
//  THE CHECK ON THE CHECKS — 검사기가 "아무것도 안 보고 통과"하지 못하게 한다.
//
//  왜 있나. 2026-09-08 하루에만 같은 부류가 셋 나왔다:
//   · audit-og-width 는 458장 중 456장을 재지 못한 채 ✅ 를 찍었다(그 456장은
//     전부 WebP 였고 파서는 PNG·JPEG 만 읽었다 — 태어난 날부터 장님이었다).
//   · audit-feed-noindex 는 피드 파일을 전부 건너뛰고 "모든 피드가 일치한다"고 했다.
//   · audit-link-destinations 는 dist 가 비어 있어도 통과했다.
//  셋 다 "결함이 없다"가 아니라 "입력을 못 봤다"였는데, 출력은 구별되지 않았다.
//  그래서 검증할 때마다 새 결함이 나온다 — 새로 생긴 게 아니라, 그동안 아무도
//  보지 않고 초록불을 켜온 것이다.
//
//  계약 하나. **볼 것이 하나도 없으면 검사기는 통과를 보고하지 않는다.**
//  아무것도 없는 저장소에서 돌렸을 때 exit 0 이면 그 검사기는 거짓말을 할 수 있다.
//  (실패든 크래시든 비-0 이면 된다. 이 검사가 요구하는 건 "통과라고 말하지 마라"뿐.)
//
//  면제는 이유와 함께 아래 EXEMPT 에 적는다. 저장소 바깥(깃허브 API·GSC·외부
//  서비스)을 보는 검사기는 빈 저장소로 재현할 수 없으므로 여기서 판정하지 않는다.
//  면제 목록에 이름만 늘리는 것으로 이 관문을 통과시키지 말 것 — 그건 관문을
//  끄는 것이지 지키는 게 아니다.
//
//    node scripts/audit-checkers.mjs            # 전부
//    node scripts/audit-checkers.mjs --only=x   # 하나만
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SCRIPTS = join(REPO, 'scripts');
const TIMEOUT_MS = 90_000;

// 저장소 안의 파일을 보지 않는 검사기 — 빈 저장소는 이들에게 아무 의미가 없다.
// 각 줄은 "왜 빈 저장소로 잴 수 없는가"를 적는다. 나중에 읽는 사람이 이 목록을
// 신뢰하려면 이유가 검증 가능해야 한다.
const EXEMPT = new Map([
  ['audit-cron-punctuality', '깃허브 Actions 실행 이력을 API 로 읽는다 — 저장소 파일이 입력이 아니다'],
  ['audit-index-coverage', 'GSC 색인 데이터를 API 로 읽는다'],
  ['audit-impression-cohort', 'GSC 노출 데이터를 API 로 읽는다'],
  ['check-4sqi-health', 'Foursquare API 의 상태를 직접 찌른다'],
  ['check-affiliate-status', '제휴사 링크를 네트워크로 확인한다'],
  ['check-publish-ran', '깃허브 워크플로 실행 이력을 본다'],
  ['audit-retired-redirects', '라이브 사이트의 응답 코드를 본다'],
  ['audit-crowd-claims', '라이브 API 응답을 본다'],
]);

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

const checkers = readdirSync(SCRIPTS)
  .filter((f) => /^(audit|check|lint)-.*\.mjs$/.test(f) && !f.includes('.test.'))
  .map((f) => f.replace(/\.mjs$/, ''))
  .filter((n) => n !== 'audit-checkers')
  .filter((n) => !only || n === only);

// 검사기가 볼 만한 자리를 전부 만들되 전부 비워둔다. 폴더가 없어서 죽는 것과
// 폴더가 비어서 통과하는 것은 다른 실패이고, 이 검사가 잡으려는 건 후자다.
function makeEmptyRepo() {
  const root = mkdtempSync(join(tmpdir(), 'checker-contract-'));
  for (const d of [
    'src/content/posts', 'src/content/i18n', 'src/content/essentials', 'src/pages', 'src/lib',
    'dist', 'data', 'public', '.github/workflows', 'scripts',
  ]) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'empty', type: 'module' }), 'utf8');
  return root;
}

// 쓰기를 하는 도구는 이 하네스가 실행하지 않는다. 2026-09-08 첫 실행에서
// audit-event-heroes 를 돌렸다가 알았다: 그 스크립트는 경로를 스크립트 위치
// 기준으로 잡아 cwd 와 무관하게 **진짜 저장소**를 읽고 고친다. 빈 저장소를
// 건네도 소용이 없었고, 비전 API 11회를 쓰고 data/visual-audit.json 을 바꿨다.
// 이름 목록으로 막으면 다음에 태어나는 같은 도구를 놓치므로 소스를 보고 정한다.
const WRITES = /\b(?:writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync|mkdirSync)\b|\bwriteFile\(|\bappendFile\(|\bunlink\(|\brename\(/;
// 경로를 스크립트 위치 기준으로 잡는 검사기는 cwd 를 바꿔도 **진짜 저장소**를 본다.
// audit-typography 가 그렇다: 빈 저장소를 건네도 실제 컴포넌트를 스캔해 정상 통과했고,
// 이 하네스는 그걸 "거짓 통과"로 잘못 읽었다. 결함이 아니라 이 하네스의 오탐이므로
// 이름으로 빼지 않고 소스에서 가려낸다 — 다음에 같은 스크립트가 생겨도 똑같이 걸린다.
const SCRIPT_RELATIVE = /import\.meta\.url/;
const sourceOf = (name) => { try { return readFileSync(join(SCRIPTS, `${name}.mjs`), 'utf8'); } catch { return ''; } };

const passed = [];   // 빈 저장소에서 통과를 보고함 = 계약 위반
const held = [];     // 제대로 비-0
const unclear = [];  // 시간 초과 — 판정 못 함
const mutating = []; // 쓰기가 있어 이 하네스로는 잴 수 없음
const unsandboxed = []; // 스크립트 기준 경로 — 빈 저장소를 건네도 진짜 저장소를 본다

for (const name of checkers) {
  if (EXEMPT.has(name)) continue;
  const src = sourceOf(name);
  if (WRITES.test(src)) { mutating.push(name); continue; }
  if (SCRIPT_RELATIVE.test(src)) { unsandboxed.push(name); continue; }
  const root = makeEmptyRepo();
  try {
    const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`)], {
      cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS,
      env: { ...process.env, WA_CHECKER_CONTRACT: '1' },
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (r.error?.code === 'ETIMEDOUT' || r.signal) unclear.push({ name, why: `${TIMEOUT_MS / 1000}초 안에 끝나지 않음` });
    else if (r.status === 0) passed.push({ name, tail: out.trim().split('\n').slice(-2).join(' / ').slice(0, 160) });
    else held.push(name);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const p of passed) {
  console.log(`CHECKER-FAILS-OPEN: ${p.name} — 빈 저장소에서 통과를 보고함`);
  if (p.tail) console.log(`      마지막 출력: ${p.tail}`);
}
for (const u of unclear) console.log(`   (판정 못 함) ${u.name} — ${u.why}`);
if (mutating.length) console.log(`   (쓰기가 있어 실행하지 않음) ${mutating.join(', ')}`);
if (unsandboxed.length) console.log(`   (스크립트 기준 경로라 빈 저장소로 못 잼) ${unsandboxed.join(', ')}`);

// 돌려볼 수 없는 검사기는 그냥 눈감아주면 사각지대가 된다 — 실제로 이 하네스의
// 첫 실행은 audit-automation 이 빈 저장소에서 "0 workflow(s) audited"로 통과하는
// 것을 잡아냈는데, 쓰기 제외 규칙을 넣자마자 그 결함이 보이지 않게 됐다.
// 실행으로 못 재는 것은 소스로 잰다: 계약을 부르는 줄이 있어야 한다.
const unproven = [...mutating, ...unsandboxed].filter((n) => !/requireExamined\s*\(/.test(sourceOf(n)));
for (const n of unproven) {
  console.log(`CHECKER-CONTRACT-UNDECLARED: ${n} — 실행으로 잴 수 없는데 requireExamined() 도 부르지 않는다`);
}

console.log(`\n📋 검사기 ${held.length + passed.length + unclear.length}개 중 ` +
  `${held.length}개는 볼 것이 없으면 통과를 거부한다 · ${passed.length}개는 거짓 통과 · ` +
  `${unclear.length}개는 판정 못 함 · 쓰기 ${mutating.length}개 · 샌드박스 불가 ${unsandboxed.length}개는 미실행 ` +
  `(면제 ${EXEMPT.size}개는 저장소 밖을 본다)`);

// 이 검사가 아무것도 실행하지 못했다면 그것 자체가 fail-open 이다 — 자기가 잡으려는
// 부류에 자기가 빠지지 않게 한다.
if (held.length + passed.length === 0) {
  console.log('CHECKER-CONTRACT: 검사기를 하나도 실행하지 못했다 — 이 실행은 아무것도 확인하지 않았다.');
  process.exit(1);
}
if (passed.length || unproven.length) process.exit(1);
console.log('✅ 모든 검사기가 "볼 것이 없으면 통과하지 않는다"는 계약을 지킨다 ' +
  `(${held.length}개는 실행으로, ${mutating.length + unsandboxed.length}개는 소스로 확인).`);
