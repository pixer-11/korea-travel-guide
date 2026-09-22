#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  평점 기준선 수리 — 감사가 찾은 것을 실제로 내린다.
//
//  왜 필요한가. refresh.mjs 는 자기가 그날 갱신하는 40편 안에서만 기준선을 본다.
//  그런데 평점이 드러나는 경로는 그것만이 아니다 — 2026-09-21~22 이틀 동안
//  geocode-placeless 가 서울·도쿄의 `place` 블록 없는 글에 좌표를 붙이면서
//  그동안 **읽을 수조차 없던 평점**이 세 건 드러났고(3.9 / 3.9 / 3.8), 셋 다
//  공개 상태로 남았다. refresh 의 순번은 최대 12주 뒤다.
//  audit-rating-floor 는 그걸 매일 찾아내고 있었지만 아무도 행동하지 않았다 —
//  이 저장소가 반복해서 만나는 "목록만 만드는 감사" 모양이다.
//
//  그래서 경로를 가리지 않는 수리를 둔다. 감사가 공개글에서 찾은 것을 전부
//  내리고, 사유를 남겨 평점이 회복되면 수리 순찰이 되올릴 수 있게 한다.
//  판정 기준과 철자는 lib/rating-floor.mjs 하나에서만 온다.
//
//    node scripts/repair-rating-floor.mjs --dry
//    node scripts/repair-rating-floor.mjs
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { belowFloor, FLOOR, HOLD_REASON } from './lib/rating-floor.mjs';
import { editFrontmatter } from './lib/frontmatter-edit.mjs';

const DIR = 'src/content/posts';
const DRY = process.argv.includes('--dry');
let scanned = 0, held = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.md'))) {
  const path = join(DIR, f);
  const raw = readFileSync(path, 'utf8');
  const norm = raw.replace(/\r\n/g, '\n');
  const e = norm.indexOf('\n---', 3);
  if (e === -1) continue;
  let d;
  try { d = yaml.load(norm.slice(4, e)); } catch { continue; }
  // 이벤트는 평점으로 판정하지 않는다. 이미 내려간 글은 건드리지 않는다.
  if (!d || d.draft || d.category === 'event') continue;
  scanned++;
  if (!belowFloor(d.place?.rating)) continue;
  console.log(`  ⭐ ${f} — ${d.place.rating} (${d.place.userRatingsTotal ?? '?'}리뷰)`);
  held++;
  if (DRY) continue;
  writeFileSync(path, editFrontmatter(raw, { draft: true, heldReason: HOLD_REASON }), 'utf8');
}
console.log(`\n⭐ 평점 기준선 수리 — 공개글 ${scanned}편 검사, ${held}편 내림 (${FLOOR} 미만)${DRY ? ' (DRY)' : ''}`);
console.log(`RATING_FLOOR_REPAIR held=${held} scanned=${scanned}`);
