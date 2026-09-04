// ─────────────────────────────────────────────────────────────
//  REGION OUTLIERS — 구역(region) 태그가 실제 장소와 어긋난 글의 발행 차단.
//
//  2026-09-02 심층검증: 라이브 글 24편의 region이 실제 주소와 다른 구역이었다
//  (사이궁의 민속박물관이 "Lantau Island", 침사추이의 우주박물관이 "Sai Kung",
//  마리나베이의 ArtScience Museum이 "Clarke Quay" …). 생성기가 검색에 쓴
//  구역명을 region에 그대로 적고, 구글이 돌려준 좌표·주소는 대조하지 않았다.
//  URL은 유지하고 region·제목만 고쳤다(07-26 URL 변경 사태 재발 금지);
//  이 검사는 같은 부류가 다시 태어나지 못하게 하는 게이트 쪽 절반이다.
//
//  규칙(scripts/lib/region-outlier.mjs): ① 주소가 같은 나라의 다른 라이브
//  구역명을 담고 자기 구역명은 안 담으면 그것만으로 잡는다(부모·자식 구역명과
//  포괄 라벨은 제외) — 원래 부류 그 자체. ② 부모·자식 이름이라도 자기 구역
//  중앙점에서 멀면(1.5 km 초과 AND 퍼짐 4배 초과, 커밋 피어 3편 이상) 잡는다.
//  ③ 좌표가 자기 구역에서 멀고 다른 구역 무리(커밋 3편 이상) 안 3 km 에 있으면
//  잡는다. 거리만 쓰던 1차 규칙은 "Hong Kong"의 디즈니랜드 같은 정상 글 62편을
//  오탐했고, 거리를 전제한 2차 규칙은 수리한 24편 중 12편을 놓쳤다.
//  게이트가 `heldReason: wrong-region` 으로 붙든다.
//
//    node scripts/audit-region-outliers.mjs               # src/content/posts 전체
//    node scripts/audit-region-outliers.mjs --since=HEAD  # 게이트: 이번 발행분은 피어에서 제외
//    node scripts/audit-region-outliers.mjs --dir=<d>     # 테스트용
//
//  --since 가 있으면 게이트와 같은 범위(git status 의 새/수정 글 + 그 ref 이후
//  추가된 글)를 "이번 발행분"으로 표시한다. 그 글들은 판정은 받되 피어·라이브
//  구역·포괄 라벨 계산에는 들어가지 않는다 — 같은 구역으로 잘못 태그된 글
//  n편이 한꺼번에 오면 중앙점이 그쪽으로 끌려가 n≥4 부터 전부 통과하던
//  뒤집힘(코덱스 리뷰 09-02)을 막는다.
//
//  출력: `REGION-OUTLIER: <file>.md — <거리> km from the <region> centre; address names <other>` ·
//  발견 시 exit 1. 아무것도 못 찾으면 한 줄 요약 후 exit 0.
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import matter from 'gray-matter';
import { findRegionOutliers, DEFAULTS } from './lib/region-outlier.mjs';

const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const DIR = dirArg ? dirArg.slice(6) : 'src/content/posts';
const since = (process.argv.find((a) => a.startsWith('--since=')) || '').slice(8);

const git = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return String(e.stdout ?? ''); }
};

// Same scope rule as gate-new-posts.mjs: untracked + modified posts (this run's
// output is not committed yet) plus files added since the ref.
const scope = new Set();
if (since) {
  for (const l of git(`git status --porcelain -- ${DIR}`).split('\n')) {
    const p = l.slice(3).trim().replace(/^"|"$/g, '');
    if (p.endsWith('.md')) scope.add(p.split('/').pop());
  }
  if (since !== 'HEAD') {
    for (const l of git(`git diff --name-only --diff-filter=A ${since} -- ${DIR}`).split('\n')) {
      const f = l.trim().split('/').pop();
      if (f?.endsWith('.md')) scope.add(f);
    }
  }
}

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
    address: data.place?.address ? String(data.place.address) : '',
    draft: data.draft === true,
    inScope: scope.has(file),
  });
}

const allHits = findRegionOutliers(posts);
// A post already quarantined for its region is not a new finding — the repair
// patrol re-checks drafts itself. They are listed, but only live posts fail the run.
const held = allHits.filter((h) => h.post.draft);
for (const h of held) console.log(`   (held draft, not counted) ${h.post.file}`);
const hits = allHits.filter((h) => !h.post.draft);
for (const h of hits) {
  const ev = h.evidence.kind === 'address'
    ? `address names ${h.evidence.region}`
    : `sits ${h.evidence.km.toFixed(1)} km inside the ${h.evidence.region} cluster`;
  const geo = h.distanceKm == null
    ? `${h.peers} committed post(s) in ${h.post.region} (${h.post.country}), no centre to measure from`
    : `${h.distanceKm.toFixed(1)} km from the ${h.post.region} (${h.post.country}) centre (${h.peers} committed posts, median spread ${h.spreadKm.toFixed(1)} km)`;
  console.log(`REGION-OUTLIER: ${h.post.file} — ${geo}; ${ev}`);
}
if (hits.length) {
  console.log(`\n${hits.length} post(s) whose region does not match their address or coordinates.`);
  process.exit(1);
}
console.log(`✓ region outliers: none among ${posts.length} posts` +
  (scope.size ? ` (${scope.size} in this run's scope, excluded from peers)` : '') +
  ` — regions with < ${DEFAULTS.minPeers} committed posts skipped`);
