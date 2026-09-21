#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  개인 식별 정보 감사 — 이 저장소는 PUBLIC 이다.
//
//  2026-09-21: 기자 요청 대응 초안을 커밋하면서 운영자 실명과 링크드인 주소가
//  공개 저장소로 나갔다(01754fbc7). 같은 날 파일에서 지웠고 "제거 완료"로 닫혔지만,
//  그건 **현재 트리만 본 판정**이었다 — 그 커밋은 지금도 공개돼 있다.
//
//  이력을 다시 쓰는 길은 택하지 않았다: 뒤따르는 모든 커밋 해시가 바뀌고 강제
//  푸시가 필요한데 병렬 세션·워크트리가 깨지고, 깃허브는 지운 커밋을 한동안
//  해시로 들고 있어 지원팀 요청까지 해야 반만 닫힌다. 이미 복제해 간 쪽은 그대로다.
//  그래서 **나간 것은 두고, 다시 들어오는 것을 막는다.**
//
//  금지어는 평문이 아니라 해시로 산다(lib/pii-scan.mjs). 찾은 값은 출력에서도
//  가린다 — CI 로그 역시 공개되기 때문이다.
//
//    node scripts/audit-pii.mjs          # 추적 중인 텍스트 파일 전부
//    node scripts/audit-pii.mjs --list   # 파일 목록만
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { piiFindings } from './lib/pii-scan.mjs';
import { requireExamined } from './lib/examined.mjs';

const LIST = process.argv.includes('--list');
// 사람이 읽는 파일만 본다. 이미지·폰트·잠금파일에는 문장이 없다.
const SKIP = /\.(webp|png|jpe?g|gif|svg|ico|woff2?|ttf|pdf|zip|mp4|enc)$|(^|\/)package-lock\.json$/i;

let files = [];
try {
  files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean).filter((f) => !SKIP.test(f));
} catch { files = []; }

let scanned = 0;
const hits = [];
for (const f of files) {
  let size = 0;
  try { size = statSync(f).size; } catch { continue; }
  if (size > 2 * 1024 * 1024) continue; // 2MB 넘는 데이터 파일은 산문이 아니다
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  scanned++;
  for (const hit of piiFindings(text)) hits.push({ file: f, ...hit });
}

if (LIST) {
  for (const h of hits) console.log(`PII: ${h.file}:${h.line}`);
  requireExamined(scanned, '추적 파일', 'git ls-files 가 비어 있나?');
  process.exit(hits.length ? 1 : 0);
}

console.log(`\n🕵️ 개인 식별 정보 감사 — 추적 파일 ${scanned}개 검사`);
if (hits.length) {
  console.log(`❌ ${hits.length}곳:\n`);
  for (const h of hits) console.log(`  • ${h.file}:${h.line} [${h.kind}]\n      ${h.excerpt}`);
  // 실패 알림이 이 줄을 보고 "저절로 난는 고장"과 구별한다(lib/diagnose-failure.mjs).
  console.log(`PII_AUDIT_FAIL count=${hits.length}`);
  console.log('\n이 저장소는 공개다. 커밋하면 파일에서 지워도 이력에 남는다 — 커밋 전에 빼라.');
  console.log('필명 정책: 바이라인·문서·초안 모두 "Pixer" 로 쓴다. 실명이 꼭 필요한 곳(계정 복구 등)은 저장소 밖에 둔다.');
  requireExamined(scanned, '추적 파일', 'git ls-files 가 비어 있나?');
  process.exit(1);
}
requireExamined(scanned, '추적 파일', 'git ls-files 가 비어 있나?');
console.log('✓ 개인 식별 정보 없음.');
