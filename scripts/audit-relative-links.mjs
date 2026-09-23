#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  우리 사이트 안에서 찾게 되는 바깥 주소 — 전수 검사.
//
//  왜 CI 에 있나: 이 부류를 처음 잡은 건 **주간** 링크 검사였다(09-23).
//  그 말은 깨진 링크가 최대 7일을 살아 있었다는 뜻이고, 잡힌 뒤에도
//  빌드된 사이트를 크롤해야만 보였다. 판정 자체는 정규식 하나로 끝나므로
//  — 모델도, 빌드도, 네트워크도 필요 없다 — 커밋 시점에 본다.
//  9,494개 md 를 훑는 데 2초면 된다.
//
//  규칙과 근거는 lib/relative-link.mjs 에 있다.
//
//    node scripts/audit-relative-links.mjs
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeLinks } from './lib/relative-link.mjs';
import { requireExamined } from './lib/examined.mjs';

const ROOT = fileURLToPath(new URL('../src/content/', import.meta.url));
// 사람이 읽는 산문이 사는 곳 전부. 번역본(i18n)이 빠져 있던 것이 이 결함이
// 커밋 게이트를 통과한 이유다 — validate-content 는 영어 원문만 본다.
const DIRS = ['posts', 'i18n', 'itineraries', 'pages', 'events'];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = DIRS.map((d) => join(ROOT, d)).filter(existsSync).flatMap((d) => walk(d));

let scanned = 0;
const hits = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  scanned++;
  const rel = f.slice(f.indexOf(`src${sep}content`)).split(sep).join('/');
  for (const { label, href } of relativeLinks(text)) hits.push({ file: rel, label, href });
}

for (const h of hits) {
  console.log(`RELATIVE-LINK: ${h.file} — [${h.label}](${h.href}) 는 스킴이 없어 글 주소 뒤에 붙는다(404).`);
}

requireExamined(scanned, '콘텐츠 md', 'src/content 가 비었나? 경로부터 확인할 것');

console.log(hits.length
  ? `\n❌ ${scanned}개 중 ${hits.length}건. 바깥 주소면 https:// 를 붙이고, 링크일 필요가 없으면 글자로 둘 것(원문이 글자면 번역도 글자다).`
  : `✓ ${scanned}개 — 스킴 없는 링크 없음.`);
process.exit(hits.length ? 1 : 0);
