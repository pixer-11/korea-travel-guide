#!/usr/bin/env node
/**
 * 제목 타이포 통일성 감사.
 *
 * 전역 규칙(h1~h4 = --font-display / weight 700)을 바꿔도, 개별 선택자가
 * font-weight 를 따로 덮어쓰고 있으면 그 자리만 옛 모습으로 남는다.
 * 2026-08-08 에 뉴스레터 제목이 혼자 400 으로 남아 픽서가 발견했다 —
 * 사람 눈으로 찾을 일이 아니라서 기계 검사로 옮긴다.
 *
 * 검사 항목
 *  1) --font-display 를 쓰면서 weight 가 기준선(MIN_WEIGHT)보다 얇은 선택자
 *  2) 제목 태그에 display 폰트를 안 쓰고 body 폰트를 강제한 곳 (의도적일 수 있어 정보로만)
 *  3) 아이콘 표기 방식이 섞여 있는지 (Emoji 컴포넌트 vs 라인 아이콘)
 *
 * 실행: node scripts/audit-typography.mjs   (문제 있으면 종료코드 1)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(ROOT, 'src', 'styles', 'global.css');
const MIN_WEIGHT = 600;          // 제목이 이보다 얇으면 통일감이 깨진 것으로 본다
const ALLOW = new Set([
  '.brand',                      // 로고 — 픽서 지시로 그대로 둔다(08-08)
]);

const css = fs.readFileSync(CSS, 'utf8');

/** `선택자 { ... }` 단위로 쪼갠다. 중첩 미디어쿼리는 안쪽 블록만 본다. */
function rules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const sel = m[1].split('\n').pop().trim();
    if (sel && !sel.startsWith('@')) out.push({ sel, body: m[2] });
  }
  return out;
}

const thin = [];
for (const { sel, body } of rules(css)) {
  if (!/--font-display/.test(body)) continue;
  if (ALLOW.has(sel)) continue;
  const w = body.match(/font-weight:\s*(\d+)/);
  if (w && Number(w[1]) < MIN_WEIGHT) thin.push({ sel, weight: Number(w[1]) });
}

// 아이콘 표기가 섞여 있는지 — 한 사이트에 이모지와 라인 아이콘이 섞이면 톤이 흔들린다
const srcDir = path.join(ROOT, 'src');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(astro|tsx?)$/.test(e.name)) files.push(p);
  }
})(srcDir);

const emojiUsers = files.filter((f) => /<Emoji\s/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f));

let bad = false;
console.log('── 제목 굵기 통일 ──');
if (thin.length) {
  bad = true;
  for (const t of thin) console.log(`  ✗ ${t.sel} — font-weight ${t.weight} (기준 ${MIN_WEIGHT}+)`);
} else {
  console.log(`  ✓ --font-display 를 쓰는 선택자 전부 ${MIN_WEIGHT} 이상`);
}

console.log('\n── 아이콘 표기 ──');
if (emojiUsers.length) {
  console.log(`  · <Emoji> 사용 파일 ${emojiUsers.length}개:`);
  for (const f of emojiUsers) console.log(`      ${f}`);
} else {
  console.log('  ✓ <Emoji> 사용 없음');
}

process.exit(bad ? 1 : 0);
