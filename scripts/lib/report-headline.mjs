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

/**
 * @param {{visits:number,pageviews:number}|null} cf  Cloudflare totals, null when that collector failed
 * @param {{visitors:number,pageviews:number}|null} pl  Plausible totals, null when that collector failed
 * @returns {string[]} lines (empty when both failed — the caller sends a failure notice instead)
 */
export function headlineLines(cf, pl) {
  const L = [];
  if (pl) {
    L.push(`👥 실제 방문자 ${pl.visitors.toLocaleString()}명 · 페이지뷰 ${pl.pageviews.toLocaleString()}`);
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
