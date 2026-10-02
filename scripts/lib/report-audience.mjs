// The daily report's "who came, from where, and what they read" block.
//
// Until 2026-10-02 the countries and the popular pages were Cloudflare's — the
// all-traffic count — printed directly under a headline that said "real
// visitors". On 10-01 that put "미국 1506 · 베트남 897" and "/ko/my-trip — 133"
// under "실제 방문자 45명": the countries were our own live checks (the runner
// and the desk) and Plausible had not seen one reader on four of the five
// "popular" pages. The owner read it as the day's audience and asked what it
// meant.
//
// So the readers' lists are Plausible's, like the headline. Cloudflare's lists
// are shown only when they explain something: on a surge day (they say where
// the automated traffic came from and what it hit), or when Plausible failed —
// and they are labelled for what they are either way.
//
// Google gets its own line every day, zero included. It dropped out of the top
// five sources on 09-04 and its absence went unremarked for 28 reports.

/**
 * @param {{countries:string, pages:string}|null} cf  Cloudflare lists (pageview counts), null when that collector failed
 * @param {{countries?:string, topSrc:string, topPages:string, google?:{day:number,d28:number}|null}|null} pl  Plausible lists, null when that collector failed
 * @param {boolean} surge  whether the all-traffic count was flagged (lib/bot-surge.mjs)
 * @returns {string[]}
 */
export function audienceLines(cf, pl, surge) {
  const L = [''];
  const ALL = '전체 접속 기준 — 봇·자동 접속 포함, 페이지뷰';

  if (pl?.countries) {
    L.push(`🌍 상위 국가 (실제 방문자): ${pl.countries}`);
    if (cf && surge) L.push(`   └ ${ALL}: ${cf.countries}`);
  } else if (cf) {
    L.push(`🌍 상위 국가 (${ALL}): ${cf.countries}`);
  }
  if (pl) {
    L.push(`🌐 유입원: ${pl.topSrc}`);
    if (pl.google) L.push(`🔎 구글 유입: ${pl.google.day}명 · 최근 28일 ${pl.google.d28}명`);
  }

  if (pl) {
    L.push('', '🔥 인기 페이지 (실제 방문자)', pl.topPages);
    if (cf && surge) L.push('', `🤖 자동 접속이 몰린 페이지 (${ALL})`, cf.pages);
  } else if (cf) {
    L.push('', `🔥 인기 페이지 (${ALL})`, cf.pages);
  }
  return L;
}
