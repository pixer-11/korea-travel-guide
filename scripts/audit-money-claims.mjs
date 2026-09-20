#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  지어낸 가격 감사 — 모델 호출 0회.
//
//  2026-09-21, 픽서님이 메단 공원 글의 사진을 확인하다 물었다: 사진은 맞나?
//  사진은 맞았다. 틀린 것은 그 옆의 글이었다 — "이런 공립공원은 보통 소액의
//  입장료를 받는다, 현지에서 확인하라". 그 공원은 무료다.
//
//  범인은 모델이 아니라 우리 프롬프트였다. ① FAQ 스키마가 "비용"을 물으라고
//  시켰고 ② 본문 규칙은 확신이 없으면 "대략, 시간을 한정해서" 적으라는 탈출구를
//  줬다. 시키는 대로 한 결과가 라이브 코퍼스에 얼버무린 답 285건, 아무도 잰 적
//  없는 금액 86건(34편)이었다. 둘 다 그날 막았다(lib/writer.mjs).
//
//  이 검사가 필요한 이유는 비용이다. 지어낸 사실을 잡을 수 있는 유일한 장치가
//  주 1회 모델 감사였다 — 틀린 글은 최대 7일 라이브였고, 확인은 글당 모델 호출.
//  가격만큼은 대조할 데이터조차 필요 없다: 우리가 받는 가격 정보는 구글의
//  priceLevel(1~4)뿐이고 금액은 한 번도 주어지지 않으므로, 글에 적힌 금액은
//  전부 지어낸 것이다. 그래서 공짜로, 발행 시점에 내린다.
//
//    node scripts/audit-money-claims.mjs           # 전수, 결함이 있으면 exit 1
//    node scripts/audit-money-claims.mjs --list    # 수리 큐용 MONEY-CLAIM: <slug>
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { moneyClaims } from './lib/money-claim.mjs';
import { requireExamined } from './lib/examined.mjs';

const DIR = 'src/content/posts';
const LIST = process.argv.includes('--list');

let posts = 0;
const byPost = new Map();
let files = [];
try { files = readdirSync(DIR).filter((f) => f.endsWith('.md')); } catch { files = []; }
for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
  const end = raw.indexOf('\n---', 3);
  if (end === -1) continue;
  let fm;
  try { fm = yaml.load(raw.slice(4, end)); } catch { continue; }
  if (!fm) continue;
  posts++;
  const slug = f.replace(/\.md$/, '');
  // 초안도 본다: 지금 고치는 편이 공개된 뒤 고치는 것보다 싸다.
  const fields = [
    ['body', raw.slice(end + 4)],
    ['quickAnswer', fm.quickAnswer || ''],
    ['description', fm.description || ''],
  ];
  for (const { q, a } of Array.isArray(fm.faq) ? fm.faq : []) fields.push(['faq', `${q} ${a}`]);
  for (const [where, text] of fields) {
    for (const hit of moneyClaims(text)) {
      if (!byPost.has(slug)) byPost.set(slug, []);
      byPost.get(slug).push({ where, ...hit });
    }
  }
}

const total = [...byPost.values()].reduce((n, v) => n + v.length, 0);
if (LIST) {
  for (const slug of byPost.keys()) console.log(`MONEY-CLAIM: ${slug}`);
  requireExamined(posts, '글', `${DIR} 가 비어 있나?`);
  process.exit(byPost.size ? 1 : 0);
}

console.log(`\n💸 지어낸 가격 감사 — 글 ${posts}편 검사`);
if (byPost.size) {
  console.log(`❌ ${byPost.size}편에 출처 없는 금액 ${total}건:\n`);
  for (const [slug, hits] of byPost) {
    console.log(`  • ${slug} (${hits.length})`);
    for (const h of hits.slice(0, 2)) console.log(`      [${h.where}] …${h.context}…`);
  }
  console.log('\n가격은 우리에게 주어지지 않는다 — 금액을 지우고 가격 "수준"을 말로 쓰거나, 어디에 붙어 있는지만 알려라.');
  requireExamined(posts, '글', `${DIR} 가 비어 있나?`);
  process.exit(1);
}
requireExamined(posts, '글', `${DIR} 가 비어 있나?`);
console.log('✓ 출처 없는 금액 없음.');
