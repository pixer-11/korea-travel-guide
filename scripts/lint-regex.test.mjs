// lint-regex 회귀 테스트.
//
// 이 린터는 "보고가 조용하면 안심"인 도구다 — 그래서 린터 자신이 고장 나도
// 화면에는 ✓만 뜬다. 실제로 두 종류의 사고를 잡으라고 만들었는데:
//   ① 백슬래시가 사라진 정규식 (\s → s: 문법은 멀쩡, 매칭은 딴판)
//   ② 이스케이프가 해석되어 들어온 보이지 않는 문자 (\b → 백스페이스 문자)
// 둘 다 심어놓고 정말 잡는지 매번 확인한다.
//
//   node scripts/lint-regex.test.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const BS = String.fromCharCode(0x08);   // 백스페이스 — 리터럴로 적지 않는다
const ZWSP = String.fromCharCode(0x200b);

// 린터를 임시 디렉터리에 대고 돌린다. { code, out } 반환.
function lint(fileName, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'lintregex-'));
  try {
    writeFileSync(join(dir, fileName), contents, 'utf8');
    try {
      const out = execFileSync(process.execPath, ['scripts/lint-regex.mjs', dir], { encoding: 'utf8' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('clean source passes', () => {
  const r = lint('ok.mjs', 'const RE = /^\\s*value\\s*$/;\nexport default RE;\n');
  return r.code === 0 ? null : `expected exit 0, got ${r.code}: ${r.out}`;
});

t('a regex that lost its backslash is caught', () => {
  // 픽스처를 런타임에 조립한다 — 소스에 그대로 적으면 린터가 이 파일을 스캔할 때
  // 진짜 결함으로 신고하고, 마지막 케이스("저장소 자체가 깨끗한가")가 영원히
  // 실패한다. 결함 예시를 다루는 도구가 늘 겪는 자기 참조 문제.
  // 슬래시까지 코드로 만든다. 문자열을 이어붙이는 정도로는 부족했다 — 린터는
  // 한 줄 안의 여는 슬래시와 닫는 슬래시 사이를 통째로 리터럴로 읽는다.
  const SL = String.fromCharCode(47);
  const r = lint('bad.mjs', `const RE = ${SL}^s*placeholder s*$${SL};\n`);
  return r.code === 1 ? null : `expected exit 1, got ${r.code}: ${r.out}`;
});

t('a backspace character inside a pattern is caught', () => {
  // `[역駅站]\b` 를 쓰려다 \b 가 실제 백스페이스로 들어온 08-04의 그 결함.
  const r = lint('astro-like.astro', `const RE = /(호선|[역駅站]${BS}|출구)/;\n`);
  if (r.code !== 1) return `expected exit 1, got ${r.code}: ${r.out}`;
  return /invisible character/.test(r.out) ? null : `wrong reason: ${r.out}`;
});

t('a zero-width space is caught', () => {
  const r = lint('zw.mjs', `const label = 'Seoul${ZWSP}Station';\n`);
  return r.code === 1 ? null : `expected exit 1, got ${r.code}: ${r.out}`;
});

t('.astro files are scanned at all', () => {
  // 08-04 이전에는 scripts/ 안의 .mjs/.js/.ts 만 봤기 때문에, 결함이 있는
  // 컴포넌트가 스캔 범위 바깥에 조용히 앉아 있었다.
  const r = lint('Component.astro', `const RE = /(a|b${BS})/;\n`);
  return r.code === 1 ? null : `.astro not scanned (exit ${r.code})`;
});

t('a tab and a newline are NOT invisible characters', () => {
  const r = lint('ws.mjs', 'const a = 1;\n\tconst b = 2;\n');
  return r.code === 0 ? null : `whitespace flagged: ${r.out}`;
});

t('the repo itself is clean', () => {
  try {
    execFileSync(process.execPath, ['scripts/lint-regex.mjs'], { encoding: 'utf8' });
    return null;
  } catch (e) {
    return `repo has findings:\n${e.stdout || ''}`;
  }
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
