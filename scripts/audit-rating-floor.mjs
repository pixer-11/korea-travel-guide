#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  평점 기준선 감사 — API 쿼터 0회.
//
//  저장된 place.rating 만 읽는다. refresh.mjs 가 12주 주기로 초안까지 평점을
//  갱신해 두므로, 이 검사기는 그 값을 읽기만 하면 된다 — closed 검사기와 같은 구조.
//  그래서 장소 평점이 회복되면 그날로 격리가 풀린다(repair-held-posts 가 부른다).
//
//    node scripts/audit-rating-floor.mjs            # 공개글
//    node scripts/audit-rating-floor.mjs --drafts   # 격리 해제 판정용(초안 포함)
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { belowFloor, FLOOR, RECOVER, isRatingHold } from './lib/rating-floor.mjs';
import { requireExamined } from './lib/examined.mjs';

const DIR = 'src/content/posts';
const DRAFTS = process.argv.includes('--drafts');
let seen = 0;
const hits = [];
let files = [];
try { files = readdirSync(DIR).filter((f) => f.endsWith('.md')); } catch { files = []; }
for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
  const e = raw.indexOf('\n---', 3);
  if (e === -1) continue;
  let d;
  try { d = yaml.load(raw.slice(4, e)); } catch { continue; }
  if (!d || d.category === 'event') continue;
  const held = isRatingHold(d.heldReason);
  if (d.draft && !(DRAFTS && held)) continue;   // 평시엔 초안을 보지 않는다
  seen++;
  if (belowFloor(d.place?.rating, Boolean(d.draft && held))) {
    hits.push(`RATING-BELOW-FLOOR: ${f} — ${d.place.rating}`);
  }
}
for (const h of hits) console.log(h);
console.log(`\n⭐ 평점 기준선 감사 — ${seen}편 검사 (내림 ${FLOOR} 미만 · 되올림 ${RECOVER} 이상)`);
requireExamined(seen, '글', `${DIR} 가 비어 있나?`);
if (hits.length) { console.log(`❌ ${hits.length}편이 기준 아래다.`); process.exit(1); }
console.log('✓ 기준선 아래 공개글 없음.');
