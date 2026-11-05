// Plausible 이 '사람'으로 센 방문 안의 자동 접속 덩어리를 찾아 뺀다.
//
// 왜 있나. Plausible 은 알려진 봇 UA 를 거르고 자바스크립트를 실행한 방문만 세서
// 일일 리포트가 '실제 방문자'로 머리에 쓴다. 그런데 2026-10-29·30 에 평범한 크롬처럼
// 보이는 자동 접속이 JS 까지 실행하며 들어왔다: 10-30 의 '실제 방문자 466명' 중
// 367명이 정확히 한 조합 — 중국 · Chrome 151.0 · Windows · Desktop · 직접 유입 — 이었고
// (10-29 는 696명 중 491명), 그중 320명은 도시 정보조차 없었다(데이터센터 IP 모양).
// 중국어 글을 한두 쪽씩 무작위로 찍고 7초 만에 나갔으며 제휴 클릭은 0회였다. 빼고 나면
// 그날 사람은 99명·평균 체류 62초 — 평소와 같은 하루다. Cloudflare 쪽 급증 감지
// (lib/bot-surge.mjs)는 이걸 못 봤다: 봇이 Plausible 에도 잡혀 두 숫자의 비율이 평소처럼
// 보였기 때문이다. 이 숫자는 월간 제휴사 재심사 판정(월 방문 700·전달 대비 -20%)의 재료라,
// 10월 3,805 방문 중 ~1,000 이 봇이면 11월이 '급감'으로 읽혀 판정이 거꾸로 틀어진다.
//
// 판별은 '한 조합이 하루를 독차지하는가'다. 사람은 나라·브라우저 버전·OS·기기·유입이
// 흩어진다. 같은 날 빙 앱 유입이 몰린 2026-10-23(퀸스타운, 실제 사람 — 멕시코·스페인·
// 콜롬비아의 실제 도시들)의 최대 조합은 67/420(16%)이고 브라우저가 'Mobile App' 이었다.
// 그래서 조건은 넷 다:
//   · 유입이 '직접'(Direct / None) — 검색·소셜에서 온 덩어리는 사람의 쏠림일 수 있다
//   · 브라우저가 'Mobile App' 아님 — 앱 안 브라우저는 리퍼러를 지워 '직접'으로 보인다
//   · 그 조합이 MIN_VISITORS 이상이면서 그날의 MIN_SHARE 이상
//   · 평균 체류 MAX_DURATION 초 미만
// 그리고 독립된 두 번째 증거 하나(코덱스 10-31: 위 넷만으로는 직접 공유된 링크로 같은
// 크롬 데스크톱 사람 150명이 몰린 날도 빠진다):
//   · 그 조합의 MIN_NO_CITY 이상이 도시 정보 없음 — 위치 DB 에 도시가 없는 IP, 즉
//     데이터센터 모양. 10-30 덩어리 320/367(87%), 10-29 423/491(86%) vs 10-23 사람 54/394(14%).
// '(not set)' 값이 낀 조합은 필터로 정확히 뺄 수 없어 건드리지 않는다(잘못 빼느니 남긴다).
// 놓치는 쪽(작은 봇)은 숫자가 조금 부푸는 것뿐이고, 잘못 잡는 쪽(사람을 뺌)은 판정을
// 틀리게 하므로 문턱은 보수적으로 둔다.

//
// 두 번째 단: 버전을 흩뜨린 덩어리(2026-11-05). 11-04 에는 같은 접속이 Chrome
// 151·146·116·110·104·108… 로 쪼개져 들어와 조합마다 16~32명 — 어느 조합도 100명이
// 안 돼 그대로 '실제 방문자 467명(중국 395)'이 됐다. 중국 402명 중 359명(89%)이 도시
// 없음, 체류 0~1초, 전부 Windows·Desktop·직접 — 모양은 10-30 과 같고 버전만 흩었다.
// 첫 단이 아무것도 못 찾으면 버전을 뺀 조합(BROAD_DIMS)으로 같은 문턱을 다시 대고,
// 이때는 그 조합 중 **도시 없는 몫만** 뺀다(cityless) — 버전을 묶으면 같은 나라의 평범한
// 크롬 사람까지 한 조합에 들어오니, 도시가 찍힌 사람은 남긴다.

export const CLUSTER_DIMS = ['visit:country', 'visit:browser', 'visit:browser_version', 'visit:os', 'visit:device', 'visit:source'];
export const BROAD_DIMS = CLUSTER_DIMS.filter((d) => d !== 'visit:browser_version');
const NO_CITY = ['is', 'visit:city_name', ['']];
export const MIN_VISITORS = 100;
export const MIN_SHARE = 0.3;
export const MAX_DURATION = 30;
export const MIN_NO_CITY = 0.5;

/**
 * @param {{dimensions:string[], metrics:number[]}[]} rows  CLUSTER_DIMS 순서의 조합 행
 *        (metrics = [visitors, pageviews, bounce_rate, visit_duration])
 * @param {number} total  그날 전체 방문자
 * @returns {{values:string[], visitors:number, pageviews:number, bounce:number, duration:number}[]}
 */
export function pickBotClusters(rows, total, dims = CLUSTER_DIMS) {
  if (!total) return [];
  const out = [];
  for (const r of rows ?? []) {
    const values = r?.dimensions ?? [];
    const [visitors = 0, pageviews = 0, bounce = 0, duration = 0] = r?.metrics ?? [];
    if (values.length !== dims.length) continue;
    if (values.some((v) => v == null || v === '' || v === '(not set)')) continue;
    const browser = values[dims.indexOf('visit:browser')];
    const source = values[dims.indexOf('visit:source')];
    if (source !== 'Direct / None') continue;
    if (browser === 'Mobile App') continue;
    if (visitors < MIN_VISITORS || visitors / total < MIN_SHARE) continue;
    if (!(duration < MAX_DURATION)) continue;
    out.push({ ...(dims !== CLUSTER_DIMS && { dims }), values, visitors, pageviews, bounce, duration: Math.round(duration) });
  }
  return out;
}

/** 한 덩어리를 Plausible 필터로 — ['and', [[is, dim, [value]], …]]; 두 번째 단은 도시 없는 몫만. */
export const clusterFilter = (c) => ['and', [
  ...(c.dims ?? CLUSTER_DIMS).map((d, i) => ['is', d, [c.values[i]]]),
  ...(c.cityless ? [NO_CITY] : []),
]];

/** 덩어리들을 빼는 필터 목록(다른 필터 앞에 이어 붙인다). */
export const excludeClusters = (clusters) => (clusters ?? []).map((c) => ['not', clusterFilter(c)]);

const KO_COUNTRY = { CN: '중국', US: '미국', SG: '싱가포르', JP: '일본', HK: '홍콩', KR: '한국', VN: '베트남', RU: '러시아', IN: '인도', DE: '독일', BR: '브라질' };

/** 리포트 한 줄용 이름: "중국·Chrome 151·Windows·직접 유입" */
export function describeCluster(c) {
  const at = (d) => c.values[(c.dims ?? CLUSTER_DIMS).indexOf(d)];
  const country = at('visit:country');
  const version = c.dims ? '(여러 버전)' : ` ${String(at('visit:browser_version')).replace(/\.0$/, '')}`;
  return `${KO_COUNTRY[country] || country}·${at('visit:browser')}${version}·${at('visit:os')}·직접 유입${c.cityless ? '·도시 없음' : ''}`;
}

/** 두 번째 증거: 후보 중 도시 없음 비율이 MIN_NO_CITY 이상인 것만 남긴다. noCity = 후보별 도시 없는 방문자 수. */
export function confirmNoCity(candidates, noCity) {
  return (candidates ?? [])
    .map((c, i) => ({ ...c, noCity: Number(noCity?.[i]) || 0 }))
    .filter((c) => c.visitors > 0 && c.noCity / c.visitors >= MIN_NO_CITY);
}

/**
 * 하루치 판별. query 는 (body) => Promise<rows> — 리포트와 CLI 가 각자의 조회 함수를 넘긴다.
 * 조회가 실패하거나 응답이 비어 있으면(전체 집계 행이 없음) 빈 목록과 이유를 돌려준다 —
 * 못 봤으면 빼지 않는다. 그 경우 호출하는 쪽은 '그대로' 숫자를 쓰고 실패를 표시한다.
 */
export async function detectBotClusters(query) {
  try {
    const [tot] = await query({ metrics: ['visitors'] });
    const total = tot?.metrics?.[0];
    if (typeof total !== 'number') throw new Error('전체 방문자 집계 행이 없다');
    const stage = async (dims) => {
      const rows = await query({ metrics: ['visitors', 'pageviews', 'bounce_rate', 'visit_duration'], dimensions: dims, pagination: { limit: 5 } });
      const candidates = pickBotClusters(rows, total, dims);
      const noCity = [];
      for (const c of candidates) {
        const [r] = await query({ metrics: ['visitors'], filters: [clusterFilter(c), NO_CITY] });
        noCity.push(r?.metrics?.[0] ?? 0);
      }
      return { candidates, clusters: confirmNoCity(candidates, noCity) };
    };
    const first = await stage(CLUSTER_DIMS);
    if (first.clusters.length) return { total, clusters: first.clusters, candidates: first.candidates.length };
    // 버전을 흩은 같은 덩어리: 도시 없는 몫만 빼고, 센 사람 수도 그 몫이다.
    const broad = await stage(BROAD_DIMS);
    const clusters = broad.clusters.map((c) => ({ ...c, cityless: true, combo: c.visitors, visitors: c.noCity }));
    return { total, clusters, candidates: first.candidates.length + broad.candidates.length };
  } catch (e) {
    return { total: null, clusters: [], error: String(e?.message || e).slice(0, 120) };
  }
}
