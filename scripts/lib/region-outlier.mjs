// ─────────────────────────────────────────────────────────────
//  REGION OUTLIER — 구역(region) 태그가 실제 장소와 어긋난 글을 찾는다.
//
//  2026-09-02 심층검증에서 라이브 글 24편의 `region`(홍콩·싱가포르·UAE·대만은
//  구역 단위)이 실제 주소와 달랐다: 사이궁에 있는 민속박물관이 "Lantau Island",
//  침사추이의 우주박물관이 "Sai Kung". 생성기가 검색어에 쓴 구역명을 그대로
//  region에 적었고, 구글이 돌려준 좌표·주소는 아무도 region과 대조하지 않았다.
//  구역 허브(/regions/<slug>/)와 일정표가 region으로 만들어지니 오류가 그대로
//  전파된다. country-bbox 게이트(같은 날)는 나라만 본다 — 이 검사가 구역 몫.
//
//  세 경로 중 하나면 잡는다(코덱스 리뷰 09-02 1·2차 — 1차 규칙은 거리만 봐서
//  "Hong Kong"의 디즈니랜드, "Beijing"의 이화원 같은 정상 글 62편을 오탐했고,
//  2차 규칙은 거리+피어 3편을 전제해 수리한 24편 중 12편을 놓쳤다):
//   1. 주소 단독 — place.address 가 같은 나라의 *다른* 라이브 구역명을 단어
//      단위로 담고 자기 구역명은 담지 않는다("… Tsim Sha Tsui, Kowloon"인데
//      region 은 Sai Kung). 피어 수·거리 불문 — 이것이 원래 부류 그 자체다.
//      단, 부모·자식 구역의 이름은 증거가 아니다(Sun Moon Lake 주소의 Nantou,
//      Koh Phi Phi 주소의 Krabi — 주소 과반이 부르는 이름으로 학습), 포괄
//      라벨(나라 이름, 두 구역 이상의 부모 — Dubai·Abu Dhabi)도 아니며, 글이
//      자기 구역의 측정된 테두리(퍼짐의 2배) 안에 있으면 지명 하나로 잡지
//      않는다(Provence 라벨 아래 Avignon 의 교황궁).
//   1b. 부모·자식 이름이라도 (a) 자기 구역에서 멀면 증거다 — Alishan 글의
//      "Chiayi County" 는 Alishan 에서 40 km 떨어진 공연장을 변호하지 못한다.
//   2. 좌표 — (a) 자기 구역에서 멀고 AND 다른 라이브 구역의 무리(커밋 3편
//      이상) 한가운데(3 km 안, 자기 구역보다 가깝게) 앉아 있다(ArtScience
//      Museum 이 Marina Bay 글들 옆). 자기 구역이 3편 미만이면 좌표로는
//      판정하지 않는다: 빽빽한 도시에선 정상 Bugis 글도 Kampong Glam 무리에서
//      0.5 km 라, 근접만으로 잡으면 한 편짜리 구역의 글이 전부 걸린다(09-03
//      시도, 라이브 29편 오탐).
//   (a) 거리 = 같은 country+region 의 커밋된 라이브 글 3편 이상이 있을 때, 그
//      구역 중앙점(위도·경도 각각의 중앙값)에서 1.5 km 초과 AND 구역 중앙
//      퍼짐(각 글→중앙점 거리의 중앙값)의 4배 초과.
//  자기 region 이 포괄 라벨이면 아예 판정하지 않는다(도시는 제 구역들을 다
//  품는다). 실측(09-03, 수리 전 24편 재생): 14편 포착, 라이브 오탐 0.
//
//  피어(peer)는 커밋된 글만이다. 이번 발행분(게이트 범위)을 피어로 세면 같은
//  구역으로 잘못 태그된 글이 여럿 한꺼번에 오면 중앙점이 그쪽으로 끌려가
//  n=3 이면 다 잡고 n≥4 면 다 놓치는 뒤집힘이 생긴다(코덱스 리뷰).
// ─────────────────────────────────────────────────────────────

export const DEFAULTS = Object.freeze({
  minPeers: 3,        // (a) 를 판정할 최소 커밋 피어 수
  minKm: 1.5,         // (a) 절대 거리 문턱 (머리말 참조 — 10 은 도시 라벨 보호용이었다)
  spreadFactor: 4,    // (a) 퍼짐 배수 문턱
  clusterKm: 3,       // (b) 다른 구역 무리로 인정할 최대 거리
  catchAllMinRegions: 2, // 이름이 이만큼의 다른 구역 주소에 들어가면 포괄 라벨
});

const EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const hasCoords = (p) => typeof p?.lat === 'number' && typeof p?.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/**
 * Median point and median spread of a set of {lat,lng} peers.
 * @returns {{ lat: number, lng: number, spreadKm: number, n: number } | null}
 */
export function regionCentre(peers) {
  const pts = peers.filter(hasCoords);
  if (!pts.length) return null;
  const lat = median(pts.map((p) => p.lat));
  const lng = median(pts.map((p) => p.lng));
  const spreadKm = median(pts.map((p) => haversineKm(p.lat, p.lng, lat, lng)));
  return { lat, lng, spreadKm, n: pts.length };
}

/**
 * (a) Is `post` geographically out of place among `peers` (the committed live
 * posts of the same country+region)? Returns null when there is nothing to say
 * — missing coordinates, or fewer than `minPeers` peers with coordinates — and
 * a finding when the post sits beyond BOTH distance thresholds.
 */
export function regionOutlier(post, peers, opts = {}) {
  const { minPeers, minKm, spreadFactor } = { ...DEFAULTS, ...opts };
  if (!hasCoords(post)) return null;
  const centre = regionCentre(peers);
  if (!centre || centre.n < minPeers) return null;
  const distanceKm = haversineKm(post.lat, post.lng, centre.lat, centre.lng);
  if (distanceKm > minKm && distanceKm > spreadFactor * centre.spreadKm) {
    return { distanceKm, spreadKm: centre.spreadKm, peers: centre.n, centre: { lat: centre.lat, lng: centre.lng } };
  }
  return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A region name followed by a street word is a street, not a place: "New York
// Ave NE, Washington" does not put the National Arboretum in New York.
const STREET = '(?!\\s+(?:Ave|Avenue|Rd|Road|St|Street|Blvd|Boulevard|Dr|Drive|Ln|Lane|Hwy|Highway|Way|Pl|Place|Sq|Square)\\b)';
const wordMatcher = (name) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])${STREET}`, 'iu');

/** Whole-word, case-insensitive, not-a-street-name: does `text` name the place `name`? */
export function mentions(text, name) {
  if (!text || !name) return false;
  return wordMatcher(name).test(String(text));
}

/**
 * (b-1) Which OTHER live region of the country does the address name?
 * Longest name first, so "Palm Jumeirah" is read before "Jumeirah". An address
 * that names the post's OWN region is a confirmation, not evidence — null.
 * Catch-all names are never evidence: "Dubai" is in every Dubai address.
 */
export function addressNamesOtherRegion(address, ownRegion, liveRegions, exclude = new Set()) {
  if (!address) return null;
  if (mentions(address, ownRegion)) return null;
  const candidates = [...liveRegions]
    .filter((r) => r !== ownRegion && !exclude.has(r))
    .sort((a, b) => b.length - a.length);
  for (const r of candidates) if (mentions(address, r)) return r;
  return null;
}

/**
 * Which live regions CONTAIN which, learned from the addresses: P is a parent
 * of R when a majority of R's addressed posts name P ("Nantou" in every Sun
 * Moon Lake address, "Krabi" in every Koh Phi Phi address, "Hualien" for
 * Taroko Gorge). An address naming a parent — or a child — of the post's own
 * region is not evidence of a wrong label; it is the same place at another
 * administrative level. Majority, not "any": one stray mention per region is
 * exactly what a mis-tagged post produces — with "any", "Tsim Sha Tsui" read
 * as a Hong Kong-wide label because the three posts wrongly filed under Sai
 * Kung / Sha Tin / Central each carried it, and the check excused the very
 * posts it was built for.
 * @returns {Map<string, Map<string, Set<string>>>} country → region → its parents
 */
export function regionParents(livePosts) {
  const byCountry = new Map();
  for (const p of livePosts) {
    if (!p.country || !p.region) continue;
    (byCountry.get(p.country) ?? byCountry.set(p.country, []).get(p.country)).push(p);
  }
  const out = new Map();
  for (const [country, posts] of byCountry) {
    const regions = new Set(posts.map((p) => p.region));
    const parents = new Map();
    for (const r of regions) {
      const addressed = posts.filter((p) => p.region === r && p.address);
      const set = new Set();
      for (const cand of regions) {
        if (cand === r) continue;
        const m = addressed.filter((p) => mentions(p.address, cand)).length;
        if (addressed.length && m * 2 > addressed.length) set.add(cand); // strict majority
      }
      parents.set(r, set);
    }
    out.set(country, parents);
  }
  return out;
}

/**
 * City-level catch-all labels per country: the country's own name, and any
 * region name that appears in the addresses of >= `catchAllMinRegions` OTHER
 * live regions of that country ("Dubai" in Deira and Jumeirah addresses).
 * @returns {Map<string, Set<string>>} country → names
 */
export function catchAllRegions(livePosts, opts = {}) {
  const { catchAllMinRegions } = { ...DEFAULTS, ...opts };
  const byCountry = new Map();
  for (const p of livePosts) {
    if (!p.country || !p.region) continue;
    (byCountry.get(p.country) ?? byCountry.set(p.country, []).get(p.country)).push(p);
  }
  // A catch-all is a parent of at least `catchAllMinRegions` other regions
  // ("Dubai" over Deira and Jumeirah) — or simply the country's own name.
  const parents = regionParents(livePosts);
  const out = new Map();
  for (const [country] of byCountry) {
    const names = new Set([country]);
    const count = new Map();
    for (const set of parents.get(country).values()) for (const p of set) count.set(p, (count.get(p) ?? 0) + 1);
    for (const [p, n] of count) if (n >= catchAllMinRegions) names.add(p);
    out.set(country, names);
  }
  return out;
}

/**
 * Run the check over a whole corpus. `posts` carry { file, country, region,
 * lat, lng, address, draft, inScope }.
 *   - peers / live regions / catch-alls come from COMMITTED, non-draft posts
 *     only (`inScope` = this publish run's new or changed files);
 *   - every post is tested, drafts included, so a re-check of a held post
 *     still reports it.
 * A finding needs (a) the distance criterion AND (b) evidence that names
 * another region: the address, or sitting inside another region's cluster.
 */
export function findRegionOutliers(posts, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const committed = posts.filter((p) => !p.draft && !p.inScope && p.country && p.region);
  const groups = new Map();
  for (const p of committed) {
    const k = `${p.country}|${p.region}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(p);
  }
  const catchAlls = catchAllRegions(committed, o);
  const parents = regionParents(committed);
  const liveByCountry = new Map();
  for (const p of committed) (liveByCountry.get(p.country) ?? liveByCountry.set(p.country, new Set()).get(p.country)).add(p.region);

  const out = [];
  for (const p of posts) {
    if (!p.country || !p.region) continue;
    const catchAll = catchAlls.get(p.country) ?? new Set([p.country]);
    if (catchAll.has(p.region)) continue; // a city label legitimately holds all its districts
    const live = liveByCountry.get(p.country) ?? new Set();
    // Not evidence: catch-alls, the own region's parents (Nantou for Sun Moon
    // Lake), and its children (George Town for Penang) — same place, other level.
    const tree = parents.get(p.country) ?? new Map();
    const related = new Set([...catchAll, ...(tree.get(p.region) ?? [])]);
    for (const [r, ps] of tree) if (ps.has(p.region)) related.add(r);
    const peers = (groups.get(`${p.country}|${p.region}`) ?? []).filter((q) => q !== p);
    const centre = regionCentre(peers);
    const distanceKm = centre && hasCoords(p) ? haversineKm(p.lat, p.lng, centre.lat, centre.lng) : null;
    const geo = { distanceKm, spreadKm: centre?.spreadKm ?? null, peers: centre?.n ?? 0 };

    // Path 1 — the address alone. "Sai Kung, New Territories" under region
    // "Lantau Island" IS the original class; it needs no peers and no distance
    // (Codex second pass: the distance+3-peer precondition left 12 of the 24
    // uncaught — Al Barsha had two posts, ArtScience sits 1.5 km from Clarke
    // Quay's centre). The address must NOT name the post's own region either;
    // addressNamesOtherRegion already returns null in that case.
    // One guard: a post still inside its own region's measured envelope (a
    // region spread over 27 km, the post 47 km out — Provence / Avignon) is
    // not out of place; an area label that contains the named town is fine.
    const insideOwn = centre && centre.n >= o.minPeers && distanceKm != null && distanceKm <= 2 * centre.spreadKm;
    const named = insideOwn ? null : addressNamesOtherRegion(p.address, p.region, live, related);
    if (named) { out.push({ post: p, ...geo, evidence: { kind: 'address', region: named } }); continue; }

    // Everything below needs (a): far from its own region.
    if (!hasCoords(p)) continue;
    const hit = regionOutlier(p, peers, o);
    if (!hit) continue;

    // Path 1b — the address names a parent or child of the own region AND the
    // post is far from it. "Chiayi County" in an Alishan address excuses
    // nothing when the post is 40 km from Alishan (the Performing Arts Center
    // in Minxiong, the railway Garage Park at Chiayi Station).
    const kin = addressNamesOtherRegion(p.address, p.region, [...related].filter((r) => !catchAll.has(r)), new Set());
    if (kin) { out.push({ post: p, ...hit, evidence: { kind: 'address', region: kin } }); continue; }

    // Path 2 — the coordinates: inside another district's cluster (>= minPeers
    // committed posts, within clusterKm, nearer than its own centre). Not for
    // a region too thin to measure: in a dense city a legitimate Bugis post
    // sits 0.5 km from the Kampong Glam cluster, so proximity alone would hold
    // every post of every one-post district (29 false holds, 09-03 trial).
    let best = null;
    for (const r of live) {
      if (r === p.region || related.has(r)) continue;
      const c = regionCentre((groups.get(`${p.country}|${r}`) ?? []).filter((q) => q !== p));
      if (!c || c.n < o.minPeers) continue;
      const d = haversineKm(p.lat, p.lng, c.lat, c.lng);
      if (d <= o.clusterKm && d < hit.distanceKm && (!best || d < best.km)) best = { region: r, km: d };
    }
    if (best) out.push({ post: p, ...hit, evidence: { kind: 'cluster', region: best.region, km: best.km } });
  }
  return out;
}
