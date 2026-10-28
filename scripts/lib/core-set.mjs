// 핵심 집합(core set) 색인 자 — 순수 함수. 네트워크·텔레그램은 scripts/audit-index-core-set.mjs 에.
//
// 왜 있나. 2026-10-28 전수 조사(22가지 방법 → 5가지 생존)의 결론 하나는 "잣대를
// 바꾸라"였다. '사이트 전체 색인 수'와 '발견됨-미색인 7,500'을 KPI 로 보면 사이트
// 안 기술 수리로 자꾸 돌아가는데, 그 7,500 은 대부분 구글이 한 번도 가져가지 않은
// 글이고 구글 스스로 색인/비색인 비율은 품질 척도가 아니라고 말한다. 대신
// "꼭 색인돼야 할 고정 집합"(영문 — 노출이 있던 페이지 + 참조형 허브)을
// data/index-core-set.json 에 결과를 보기 전에 고정하고, 매주 같은 자로 잰다.
//
// 재는 것 세 가지:
//   · 고정 집합의 색인% · 28일 노출%  — 사이트가 아니라 '중요한 페이지'가 살아 있나.
//     분모는 고정 집합뿐이다(fixed !== false). 그 뒤에 생긴 직접 경험 글은 검사는
//     하되 분모에 넣지 않는다 — 분모가 매주 바뀌면 비율을 주 단위로 비교할 수 없다.
//   · 정체(stale): 색인됐는데 staleDays(기본 90일) 넘게 재크롤이 없는 페이지.
//     색인된 글이 조용히 빠지는 것을, 지금 있는 노출이 사라지기 전에 본다.
//   · 코호트: 직접 경험(현장메모·본인 사진)을 넣은 글(firsthand)·정체 글에 검증된 사진을
//     더한 글(photoRefresh)과 같은 나라의 손대지 않은 글(control)의 '바뀐 뒤 재크롤률'.
//     그룹은 Map<url, since> — URL 마다 '바뀐 날'이 다르므로 그 날 이후의 크롤만 센다
//     (공통 시작일로 세면 사진을 넣기 전의 크롤까지 성과가 된다). 비교군은 코호트 시작일.
//     9월에 기계 수리(em대시·시제)만 한 278편은 재크롤이 안 왔다 — 경험·사진이
//     들어가야 다른지 재는 것이다.
//
// 합격선은 집합 파일(thresholds)에 적혀 있고 judgeCohort 가 적용만 한다 — 결과를 본
// 뒤에 기준을 고치는 일이 없도록(09-10 스로틀 판정에서 배운 것: 절대값이 아니라 비율로).

export function isIndexed(coverageState) {
  const s = String(coverageState || '');
  return /indexed/i.test(s) && !/not indexed/i.test(s);
}

// 두 ISO 시각 사이의 정수 일수. 파싱이 안 되면 null — 0 으로 두면 '방금 크롤'로 읽힌다.
export function daysBetween(fromIso, toIso) {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

const rate = (num, den) => (den ? num / den : null);

// 그룹은 Map<url, sinceIso>(URL 별 '바뀐 날') 또는 Set<url>(전부 cohortStart). 어느 쪽이든 받는다.
const sinceOf = (group, url, fallback) => (group instanceof Map ? group.get(url) : null) || fallback;
const memberOf = (group, url) => group.has(url);

// rows: [{ url, kind, country, fixed, coverageState, lastCrawlTime, impressions, error }]
// groups: { name: Map<url, since> | Set<url> } — treatment 그룹들.
//         control = 그룹 나라와 같은 나라의 고정 집합 posts 중 어느 그룹에도 없는 것.
// prev / baseline: Map<url, { coverageState, lastCrawlTime }> — 지난 주·첫 주 기록.
export function summarize(rows, {
  today, staleDays = 90, cohortStart = null, prev = new Map(), baseline = new Map(), groups = {},
} = {}) {
  const measured = rows.filter((r) => !r.error);
  const errors = rows.length - measured.length;
  const core = measured.filter((r) => r.fixed !== false);
  const extra = measured.length - core.length;
  const indexedOf = (r) => isIndexed(r.coverageState);
  const exposedOf = (r) => (r.impressions || 0) > 0;
  const staleOf = (r) => indexedOf(r) && !!r.lastCrawlTime && (daysBetween(r.lastCrawlTime, today) ?? 0) > staleDays;

  const indexed = core.filter(indexedOf).length;
  const exposed = core.filter(exposedOf).length;
  const staleUrls = core.filter(staleOf).map((r) => r.url);

  const byKind = {};
  for (const r of core) {
    const b = (byKind[r.kind || 'other'] ||= { n: 0, indexed: 0, exposed: 0, stale: 0 });
    b.n++;
    if (indexedOf(r)) b.indexed++;
    if (exposedOf(r)) b.exposed++;
    if (staleOf(r)) b.stale++;
  }

  // 지난 주 대비 색인 획득·상실 — 사이트 총계가 숨기는 교체(churn)를 본다.
  const gained = [];
  const lost = [];
  for (const r of measured) {
    const p = prev.get(r.url);
    if (!p) continue;
    const was = isIndexed(p.coverageState);
    const now = indexedOf(r);
    if (!was && now) gained.push(r.url);
    if (was && !now) lost.push(r.url);
  }

  const crawledSince = (r, since) => !!(since && r.lastCrawlTime && Date.parse(r.lastCrawlTime) >= Date.parse(since));
  const newlyIndexed = (r) => indexedOf(r) && baseline.has(r.url) && !isIndexed(baseline.get(r.url).coverageState);
  const tally = (members, sinceFn) => {
    const re = members.filter((r) => crawledSince(r, sinceFn(r))).length;
    return {
      n: members.length,
      recrawled: re,
      recrawlRate: rate(re, members.length),
      indexed: members.filter(indexedOf).length,
      newlyIndexed: members.filter(newlyIndexed).length,
    };
  };

  const groupList = Object.entries(groups);
  const inAnyGroup = (url) => groupList.some(([, g]) => memberOf(g, url));
  const groupCountries = new Set(measured.filter((r) => inAnyGroup(r.url)).map((r) => r.country).filter(Boolean));
  const cohort = {};
  for (const [name, g] of groupList) {
    cohort[name] = tally(measured.filter((r) => memberOf(g, r.url)), (r) => sinceOf(g, r.url, cohortStart));
  }
  const controls = core.filter((r) => r.kind === 'posts' && !inAnyGroup(r.url) && groupCountries.has(r.country));
  cohort.control = { ...tally(controls, () => cohortStart), countries: [...groupCountries].sort() };

  return {
    n: core.length, extra, measured: measured.length, errors,
    indexed, indexedRate: rate(indexed, core.length),
    exposed, exposedRate: rate(exposed, core.length),
    stale: staleUrls.length, staleRate: rate(staleUrls.length, indexed), staleDays, staleUrls,
    byKind, gained, lost, cohort, cohortStart,
  };
}

// 사전 등록한 합격선을 적용만 한다. thresholds 예:
//   { judgeOn: '2026-12-09', group: 'firsthand', recrawlRatio: 2, minNewlyIndexed: 1 }
// 반환 key: tooEarly | unmeasured | unmeasurable | expand | noEffect
export function judgeCohort(summary, thresholds, today) {
  const t = thresholds || {};
  if (!t.judgeOn || !today || today < t.judgeOn) return { key: 'tooEarly', meaning: `판정일은 ${t.judgeOn || '미정'} 이다. 그 전 수치는 결론이 아니다.` };
  const g = summary.cohort?.[t.group];
  const c = summary.cohort?.control;
  if (!g || !c || !g.n) return { key: 'unmeasured', meaning: `코호트 '${t.group}' 이 비어 있다 — 직접 경험 글이 집합에 없다.` };
  if (g.recrawled === 0 && c.recrawled === 0) return { key: 'unmeasurable', meaning: '치료군·비교군 모두 재크롤 0 — 구글이 어느 쪽도 다시 보지 않아 측정 불가. 실험을 닫고 재제안하지 않는다.' };
  const ratio = c.recrawlRate ? (g.recrawlRate ?? 0) / c.recrawlRate : (g.recrawled > 0 ? Infinity : 0);
  const win = ratio >= (t.recrawlRatio ?? 2) && g.newlyIndexed >= (t.minNewlyIndexed ?? 1);
  const x = ratio === Infinity ? '∞' : ratio.toFixed(1);
  return win
    ? { key: 'expand', ratio, meaning: `치료군 재크롤률이 비교군의 ${x}배이고 미색인→색인 전환 ${g.newlyIndexed}건 — 현장메모 우선순위를 확대한다.` }
    : { key: 'noEffect', ratio, meaning: `치료군 재크롤률 ${pct(g.recrawlRate)} vs 비교군 ${pct(c.recrawlRate)}(${x}배), 전환 ${g.newlyIndexed}건 — 합격선(${t.recrawlRatio ?? 2}배·전환 ≥${t.minNewlyIndexed ?? 1}) 미달.` };
}

export const pct = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

const short = (u) => String(u).replace(/^https?:\/\/[^/]+/, '').slice(0, 60);
const GROUP_KO = { firsthand: '직접경험', photoRefresh: '사진보강', control: '비교군' };

// 텔레그램 본문(한국어). 측정 실패가 많으면 비율을 '참고만'으로 표시한다 — 못 본 것은 통과가 아니다.
export function formatReport(s, { at, judge, thresholds } = {}) {
  const total = s.n + (s.extra || 0) + s.errors;
  const incomplete = s.errors > 0 && s.errors / Math.max(total, 1) > 0.2;
  const lines = [];
  lines.push(`📏 핵심 집합 색인 자 — ${String(at || '').slice(0, 10)}`);
  if (incomplete) lines.push(`⚠️ 측정 불완전: ${total}쪽 중 ${s.errors}쪽을 못 봤다 — 아래 비율은 참고만.`);
  lines.push(`고정 집합 ${s.n}쪽${s.extra ? `(+집합 밖 직접경험 ${s.extra})` : ''} · 색인 ${pct(s.indexedRate)}(${s.indexed}) · 28일 노출 ${pct(s.exposedRate)}(${s.exposed}) · 정체(${s.staleDays}일+ 미재크롤) ${s.stale}쪽(색인의 ${pct(s.staleRate)})`);
  const kinds = Object.entries(s.byKind).sort((a, b) => b[1].n - a[1].n)
    .map(([k, b]) => `${k} ${b.indexed}/${b.n}${b.stale ? `(정체 ${b.stale})` : ''}`);
  if (kinds.length) lines.push(`종류별 색인: ${kinds.join(' · ')}`);
  if (s.gained.length || s.lost.length) {
    lines.push(`지난 주 대비: 색인 획득 ${s.gained.length} · 상실 ${s.lost.length}`);
    for (const u of s.gained.slice(0, 5)) lines.push(`  ＋ ${short(u)}`);
    for (const u of s.lost.slice(0, 5)) lines.push(`  － ${short(u)}`);
  }
  if (s.cohortStart) {
    const parts = Object.entries(s.cohort).map(([name, c]) => `${GROUP_KO[name] || name} ${c.recrawled}/${c.n} 재크롤(${pct(c.recrawlRate)})${c.newlyIndexed ? ` 신규색인 ${c.newlyIndexed}` : ''}`);
    lines.push(`코호트(${s.cohortStart} 시작, 바뀐 날 이후 크롤만): ${parts.join(' · ')}`);
  }
  if (judge) lines.push(`판정: ${judge.key} — ${judge.meaning}`);
  else if (thresholds?.judgeOn) lines.push(`판정일 ${thresholds.judgeOn} (그 전엔 결론 없음)`);
  return lines.join('\n');
}
