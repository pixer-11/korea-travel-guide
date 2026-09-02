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
//  판정은 두 증거가 모두 있어야 한다(코덱스 리뷰 09-02, 1차 규칙의 오탐 62건):
//   (a) 거리 — 같은 country+region 의 커밋된 라이브 글 3편 이상이 있을 때, 그
//       구역 중앙점(위도·경도 각각의 중앙값)에서 2 km 초과 AND 구역 중앙
//       퍼짐(각 글→중앙점 거리의 중앙값)의 4배 초과. 절대 문턱이 2 km 인
//       이유: 1차 규칙의 10 km 는 넓은 도시 라벨을 지키려는 값이었는데 그 몫은
//       이제 (b)가 맡고, 이 부류의 실제 사례는 빽빽한 도시의 구역들이라
//       (ArtScience Museum 은 Clarke Quay 중앙에서 1.5 km) 10 km 로는 수리한
//       24편 중 5편만 잡혔다 — 2 km 로 12편, 오탐은 늘지 않았다(09-03 실측).
//   (b) 다른 구역의 증거 — 글의 place.address 가 같은 나라의 *다른* 라이브
//       구역명을 단어 단위로 담고 있거나("… Tsim Sha Tsui, Kowloon"인데 region
//       은 Sai Kung), 좌표가 다른 라이브 구역의 무리 한가운데(3 km 안, 자기
//       구역보다 가깝게) 앉아 있다(ArtScience Museum 이 Marina Bay 글 4편 옆).
//  거리 하나만으로는 "Hong Kong"의 디즈니랜드, "Beijing"의 이화원처럼 넓은
//  도시 라벨의 정상 글이 잡힌다. 그래서 (b)가 있어야 하고, 도시급 포괄
//  라벨(나라 이름과 같거나, 다른 구역 글들의 주소에 두루 들어가는 이름 —
//  Hong Kong·Singapore·Dubai·Abu Dhabi)은 (b)의 후보에서 빼며, 글 자신의
//  region 이 그 포괄 라벨이면 아예 판정하지 않는다(도시는 제 구역들을 다
//  품는다).
//
//  피어(peer)는 커밋된 글만이다. 이번 발행분(게이트 범위)을 피어로 세면 같은
//  구역으로 잘못 태그된 글이 여럿 한꺼번에 오면 중앙점이 그쪽으로 끌려가
//  n=3 이면 다 잡고 n≥4 면 다 놓치는 뒤집힘이 생긴다(코덱스 리뷰).
// ─────────────────────────────────────────────────────────────

export const DEFAULTS = Object.freeze({
  minPeers: 3,        // (a) 를 판정할 최소 커밋 피어 수
  minKm: 2,           // (a) 절대 거리 문턱 (머리말 참조 — 10 은 도시 라벨 보호용이었다)
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
export function addressNamesOtherRegion(address, ownRegion, liveRegions, catchAlls = new Set()) {
  if (!address) return null;
  if (mentions(address, ownRegion)) return null;
  const candidates = [...liveRegions]
    .filter((r) => r !== ownRegion && !catchAlls.has(r))
    .sort((a, b) => b.length - a.length);
  for (const r of candidates) if (mentions(address, r)) return r;
  return null;
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
  const out = new Map();
  for (const [country, posts] of byCountry) {
    const names = new Set([country]);
    const regions = new Set(posts.map((p) => p.region));
    for (const r of regions) {
      // Count per OTHER region how many of its posts name r, and require a
      // MAJORITY of that region's addressed posts. One stray mention per region
      // is exactly what a mis-tagged post produces — before this, "Tsim Sha
      // Tsui" read as a Hong Kong catch-all because the three posts wrongly
      // filed under Sai Kung / Sha Tin / Central each carried it in their
      // address, and the check then excused the very posts it was built for.
      const hits = new Map(); // other region → [mentioning, addressed]
      for (const p of posts) {
        if (p.region === r || !p.address) continue;
        const c = hits.get(p.region) ?? [0, 0];
        c[1]++;
        if (mentions(p.address, r)) c[0]++;
        hits.set(p.region, c);
      }
      let others = 0;
      for (const [m, n] of hits.values()) if (m * 2 > n) others++;
      if (others >= catchAllMinRegions) names.add(r);
    }
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
  const liveByCountry = new Map();
  for (const p of committed) (liveByCountry.get(p.country) ?? liveByCountry.set(p.country, new Set()).get(p.country)).add(p.region);

  const out = [];
  for (const p of posts) {
    if (!p.country || !p.region) continue;
    const catchAll = catchAlls.get(p.country) ?? new Set([p.country]);
    if (catchAll.has(p.region)) continue; // a city label legitimately holds all its districts
    const peers = (groups.get(`${p.country}|${p.region}`) ?? []).filter((q) => q !== p);
    const hit = regionOutlier(p, peers, o);
    if (!hit) continue;
    const live = liveByCountry.get(p.country) ?? new Set();
    let evidence = null;
    const named = addressNamesOtherRegion(p.address, p.region, live, catchAll);
    if (named) evidence = { kind: 'address', region: named };
    else if (hasCoords(p)) {
      // (b-2) inside another district's cluster: >= minPeers committed posts,
      // within clusterKm, and nearer than the post's own region centre.
      let best = null;
      for (const r of live) {
        if (r === p.region || catchAll.has(r)) continue;
        const c = regionCentre((groups.get(`${p.country}|${r}`) ?? []).filter((q) => q !== p));
        if (!c || c.n < o.minPeers) continue;
        const d = haversineKm(p.lat, p.lng, c.lat, c.lng);
        if (d <= o.clusterKm && d < hit.distanceKm && (!best || d < best.km)) best = { region: r, km: d };
      }
      if (best) evidence = { kind: 'cluster', region: best.region, km: best.km };
    }
    if (evidence) out.push({ post: p, ...hit, evidence });
  }
  return out;
}
