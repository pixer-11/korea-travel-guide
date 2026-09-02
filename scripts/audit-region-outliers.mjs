// ─────────────────────────────────────────────────────────────
//  REGION OUTLIERS — 구역(region) 태그가 좌표와 어긋난 글의 발행 차단.
//
//  2026-09-02 심층검증: 라이브 글 24편의 region이 실제 주소와 다른 구역이었다
//  (사이궁의 민속박물관이 "Lantau Island", 침사추이의 우주박물관이 "Sai Kung",
//  마리나베이의 ArtScience Museum이 "Clarke Quay" …). 생성기가 검색에 쓴
//  구역명을 region에 그대로 적고, 구글이 돌려준 좌표는 대조하지 않았다.
//  URL은 유지하고 region·제목만 고쳤다(07-26 URL 변경 사태 재발 금지);
//  이 검사는 같은 부류가 다시 태어나지 못하게 하는 게이트 쪽 절반이다.
//
//  규칙(scripts/lib/region-outlier.mjs): 같은 country+region 에 좌표 있는
//  라이브 글이 3편 이상일 때, 구역 중앙점에서 10 km 초과 AND 구역 중앙
//  퍼짐의 4배 초과면 이상치. 게이트가 `heldReason: wrong-region` 으로 붙든다.
//
//    node scripts/audit-region-outliers.mjs            # src/content/posts 전체
//    node scripts/audit-region-outliers.mjs --dir=<d>  # 테스트용
//
//  출력: `REGION-OUTLIER: <file>.md — <거리> km from <region> centre (…)` ·
//  발견 시 exit 1. 아무것도 못 찾으면 한 줄 요약 후 exit 0.
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { findRegionOutliers, DEFAULTS } from './lib/region-outlier.mjs';

const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const DIR = dirArg ? dirArg.slice(6) : 'src/content/posts';

const posts = [];
for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.md')) continue;
  let data;
  try { ({ data } = matter(readFileSync(join(DIR, file), 'utf8'))); } catch { continue; } // validate-content reports unreadable files
  posts.push({
    file,
    country: data.country ? String(data.country).trim() : '',
    region: data.region ? String(data.region).trim() : '',
    lat: data.place?.lat,
    lng: data.place?.lng,
    draft: data.draft === true,
  });
}

const hits = findRegionOutliers(posts);
for (const h of hits) {
  console.log(
    `REGION-OUTLIER: ${h.post.file} — ${h.distanceKm.toFixed(1)} km from the ${h.post.region} (${h.post.country}) centre; ` +
    `${h.peers} other posts there sit within a median ${h.spreadKm.toFixed(1)} km ` +
    `(rule: > ${DEFAULTS.minKm} km and > ${DEFAULTS.spreadFactor}× spread)`
  );
}
if (hits.length) {
  console.log(`\n${hits.length} post(s) whose region does not match their coordinates.`);
  process.exit(1);
}
console.log(`✓ region outliers: none among ${posts.length} posts (regions with < ${DEFAULTS.minPeers} located posts skipped)`);
