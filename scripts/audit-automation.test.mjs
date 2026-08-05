// audit-automation 회귀 테스트.
//
// 이 검사기는 "검사기들이 실제로 검사하고 있는가"를 본다. 그러니 이것이 조용히
// 망가지면 나머지 전부가 다시 보이지 않게 된다 — 2026-08-05에 실제로 그랬다.
// 결함이 있는 워크플로 픽스처를 만들어 매번 정말 잡는지 확인하고, 멀쩡한
// 워크플로를 잡지 않는지도 함께 고정한다(오탐이 나오는 검사기는 사람이 읽지
// 않게 되고, 그러면 없는 것과 같다).
//
//   node scripts/audit-automation.test.mjs
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function audit(files) {
  const dir = mkdtempSync(join(tmpdir(), 'autoaudit-'));
  try {
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, 'utf8');
    try {
      const out = execFileSync(process.execPath, ['scripts/audit-automation.mjs', dir], { encoding: 'utf8' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const TELEGRAM = '          curl -s "https://api.telegram.org/bot$T/sendMessage" -d text="$MSG"';

// "지적 없음"은 종료 코드로만 판정한다. 요약 줄이 "SILENT-JOB=0" 처럼 항목명을
// 그대로 포함하기 때문에, 출력에 대한 단순 패턴 검사는 언제나 참이 되어 멀쩡한
// 통과를 오탐으로 뒤집는다 — 검사기를 검사하는 코드가 먼저 틀린 사례.
const clean = (r) => r.code === 0;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('0건인데 성공을 알리는 워크플로를 잡는다', () => {
  // 링크 검사가 몇 주 동안 해온 그대로의 모양.
  const r = audit({
    'x.yml': `name: Weekly check\njobs:\n  a:\n    steps:\n      - run: |\n          if [ "$JOB" != "success" ]; then\n            echo "실패"\n          elif [ "\${BROKEN:-0}" = "0" ]; then\n            echo "✅ 깨진 링크 0개 (전체 \${TOTAL}개) — 완벽합니다"\n          fi\n${TELEGRAM}\n`,
  });
  return /EMPTY-PASS/.test(r.out) ? null : `놓침: ${r.out}`;
});

t('검사량 하한 가드가 있으면 잡지 않는다', () => {
  const r = audit({
    'x.yml': `name: Weekly check\njobs:\n  a:\n    steps:\n      - run: |\n          if [ "$total" -lt 100 ]; then\n            echo "::error::crawl examined only $total link(s) — the crawler is not reading the site"\n            exit 1\n          fi\n          if [ "\${BROKEN:-0}" = "0" ]; then\n            echo "✅ 0개"\n          fi\n${TELEGRAM}\n`,
  });
  return clean(r) ? null : `오탐: ${r.out}`;
});

t('실제 작업이 있었을 때만 보고하는 워크플로는 잡지 않는다', () => {
  // quality-audit 형태: 커밋이 생겼을 때만 알린다 → 0은 "고칠 게 없었다"는 뜻.
  const r = audit({
    'x.yml': `name: Quality\njobs:\n  a:\n    steps:\n      - name: Notify\n        if: steps.commit.outputs.committed == '1'\n        run: |\n          if [ "\${ADDR:-0}" = "0" ]; then\n            MSG="정비했어요"\n          fi\n${TELEGRAM}\n`,
  });
  return clean(r) ? null : `오탐: ${r.out}`;
});

t('알림도 없고 감시 목록에도 없는 워크플로를 잡는다', () => {
  const r = audit({ 'quiet.yml': 'name: Quiet job\njobs:\n  a:\n    steps:\n      - run: node scripts/thing.mjs\n' });
  return /SILENT-JOB/.test(r.out) ? null : `놓침: ${r.out}`;
});

t('감시 목록에 이름이 있으면 잡지 않는다', () => {
  const r = audit({
    'quiet.yml': 'name: Quiet job\njobs:\n  a:\n    steps:\n      - run: node scripts/thing.mjs\n',
    'job-failure-alert.yml': `name: Job failure alert\non:\n  workflow_run:\n    workflows:\n      - 'Quiet job'\n    types: [completed]\njobs:\n  a:\n    steps:\n${TELEGRAM}\n`,
  });
  return clean(r) ? null : `오탐: ${r.out}`;
});

t('재사용 워크플로(workflow_call)는 잡지 않는다', () => {
  const r = audit({ 'reusable.yml': 'name: Reusable\non:\n  workflow_call:\n    inputs:\n      count:\n        type: string\njobs:\n  a:\n    steps:\n      - run: echo hi\n' });
  return clean(r) ? null : `오탐: ${r.out}`;
});

t('|| true 로 쓴 파일을 아무도 확인하지 않으면 잡는다', () => {
  const r = audit({
    'x.yml': `name: Crawl\njobs:\n  a:\n    steps:\n      - run: |\n          npx thing --format csv > /tmp/out.csv || true\n          count=$(wc -l < /tmp/other.csv)\n${TELEGRAM}\n`,
  });
  return /SWALLOWED/.test(r.out) ? null : `놓침: ${r.out}`;
});

t('빈 파일 검사가 있으면 잡지 않는다', () => {
  const r = audit({
    'x.yml': `name: Crawl\njobs:\n  a:\n    steps:\n      - run: |\n          npx thing --format csv > /tmp/out.csv || true\n          if [ ! -s /tmp/out.csv ]; then\n            echo "::error::no output"\n            exit 1\n          fi\n${TELEGRAM}\n`,
  });
  return clean(r) ? null : `오탐: ${r.out}`;
});

t('개행 없이 join 으로 쓴 목록 파일을 heredoc 으로 넘기면 잡는다', () => {
  // 접근성 검사가 "문제를 찾은 날에만" 실패하던 그 모양.
  const r = audit({
    'x.yml': `name: A11y\njobs:\n  a:\n    steps:\n      - run: |\n          node -e 'fs.writeFileSync("/tmp/list.txt", lines.slice(0, 10).join("\\n"));'\n          { echo "list<<EOF_LIST"; cat /tmp/list.txt; echo "EOF_LIST"; } >> "$GITHUB_OUTPUT"\n${TELEGRAM}\n`,
  });
  return /HEREDOC-GLUE/.test(r.out) ? null : `놓침: ${r.out}`;
});

t('개행을 붙여 쓰면 잡지 않는다', () => {
  const r = audit({
    'x.yml': `name: A11y\njobs:\n  a:\n    steps:\n      - run: |\n          node -e 'const body = lines.join("\\n"); fs.writeFileSync("/tmp/list.txt", body ? body + "\\n" : "");'\n          { echo "list<<EOF_LIST"; cat /tmp/list.txt; echo "EOF_LIST"; } >> "$GITHUB_OUTPUT"\n${TELEGRAM}\n`,
  });
  return clean(r) ? null : `오탐: ${r.out}`;
});

t('깨끗한 워크플로 하나만 있으면 아무것도 보고하지 않는다', () => {
  const r = audit({
    'ok.yml': `name: Fine\njobs:\n  a:\n    steps:\n      - run: node scripts/thing.mjs\n${TELEGRAM}\n`,
  });
  return r.code === 0 ? null : `오탐: ${r.out}`;
});

t('저장소의 실제 워크플로가 지금 깨끗하다', () => {
  try {
    execFileSync(process.execPath, ['scripts/audit-automation.mjs'], { encoding: 'utf8' });
    return null;
  } catch (e) { return `실제 워크플로에 지적 있음:\n${e.stdout || ''}`; }
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
