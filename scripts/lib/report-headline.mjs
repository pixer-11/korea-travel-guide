// The daily report's first lines: how many people came.
//
// Real visitors (Plausible) lead; Cloudflare's all-traffic count sits under it.
// Until 2026-09-28 Cloudflare led, and the line under it explained the gap as
// "ad-block users are excluded" — but the gap is mostly bots and the owner's own
// visits (Plausible skips both; Cloudflare cannot), e.g. 269 vs 41 on 09-24.
// The owner was asked four times to flip the order, and the wrong reason sat
// above every alarm. Bot waves are still flagged on the Cloudflare line
// (lib/bot-surge.mjs; 09-18/19 read 7,498 and 6,125 against 41 and 34 people).
//
// The flag says "automated traffic", not "bots": on 2026-10-01 it fired on
// 2,688 visits that were mostly our own live checks, and "봇으로 부풀었습니다"
// named a culprit nobody had measured. The shape (many visits per person, one
// page each) tells automated from human — it cannot tell whose automation.
import { botSurge } from './bot-surge.mjs';
import { describeCluster } from './plausible-bot-cluster.mjs';

// When Plausible itself counted an automated cluster (10-29/30: one Chrome
// build from China, 367 of 466 "real visitors"), the headline already excludes
// it (analytics-report.mjs). Say what was removed, so the drop from yesterday's
// inflated figure is explained rather than mysterious.
function clusterLine(pl) {
  const cs = pl?.botClusters ?? [];
  if (!cs.length) return null;
  // The headline's own before-minus-after when the report supplied it; the
  // clusters' counts only as a fallback (they can overlap — Codex, 10-31).
  const n = Number.isFinite(pl.botRemoved) && pl.botRemoved > 0 ? pl.botRemoved : cs.reduce((s, c) => s + c.visitors, 0);
  const what = cs.map((c) => `${describeCluster(c)} — 그 조합 ${c.visitors.toLocaleString()}명, 평균 ${c.duration}초`).join(' / ');
  return `   └ 🤖 자동 접속 의심 ${n.toLocaleString()}명은 뺐습니다(${what}) — 위 숫자와 아래 국가·유입·인기 페이지는 이걸 뺀 값입니다`;
}

/**
 * @param {{visits:number,pageviews:number}|null} cf  Cloudflare totals, null when that collector failed
 * @param {{visitors:number,pageviews:number}|null} pl  Plausible totals, null when that collector failed
 * @returns {string[]} lines (empty when both failed — the caller sends a failure notice instead)
 */
export function headlineLines(cf, pl) {
  const L = [];
  if (pl) {
    L.push(`👥 실제 방문자 ${pl.visitors.toLocaleString()}명 · 페이지뷰 ${pl.pageviews.toLocaleString()}`);
    const cl = clusterLine(pl);
    if (cl) L.push(cl);
    if (cf) {
      const surge = botSurge(cf, pl);
      L.push(`   └ 전체 접속(봇·본인 포함) ${cf.visits.toLocaleString()}회 · 페이지뷰 ${cf.pageviews.toLocaleString()}${surge.suspect ? ' ⚠️ 자동 접속 급증' : ''}`);
      if (surge.suspect) L.push(`   └ ⚠️ 전체 접속이 사람이 아닌 접속(봇·자동 검사)으로 크게 부풀었습니다 (${surge.why}) — 규모는 맨 위 실제 방문자로 보세요`);
    } else {
      L.push('   └ ⚠️ 전체 접속(Cloudflare) 수집 실패');
    }
  } else if (cf) {
    L.push(`👥 전체 접속 ${cf.visits.toLocaleString()}회 · 페이지뷰 ${cf.pageviews.toLocaleString()}`);
    L.push('   └ ⚠️ 실제 방문자(Plausible) 수집 실패 — 위 숫자는 봇과 본인 접속이 섞인 값입니다');
  }
  return L;
}
