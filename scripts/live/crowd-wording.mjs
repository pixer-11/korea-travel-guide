// Live check (2026-11-02): crowd data is a FORECAST, and the site must say so.
//
// BestTime's numbers are forecasts built from historical visit patterns, fetched
// once per guide when it is published (the oldest from July). Until 11-02 the
// home page called them "Live crowd data" / "실측 혼잡 데이터", every chart said
// "measured foot traffic" / "실시간 방문자 데이터", and the methodology page
// promised a "rolling refresh" that never ran — while the crowd tool itself said
// "forecast". This keeps the words from creeping back, page by page and in all
// five languages, and checks that a chart shows the day its forecast was fetched.
// Fetch only — no browser, no JS, so nothing reaches the analytics.
//
// Run: node scripts/live/crowd-wording.mjs [base]
import { BASE, verdict, deployLag } from './lib.mjs';

// Words that claim live or measured crowds. Scoped to crowd wording: "real-time
// fares" on the flights page and "live prices" on eSIM pages are true and are
// not on these pages' crowd blocks.
const BANNED = [
  /Live crowd data/i, /Live foot-traffic/i, /measured foot[- ]traffic/i, /Measured · by hour/, /measured hour by hour/i,
  /Outside measured hours/, /Live crowd widget/,
  /실측/, /실시간 방문자 데이터/, /실시간 인파/, /실시간 혼잡/,
  /実測/, /リアルタイム混雑/, /ライブ混雑/, /live foot-traffic forecasts/i, /embeddable live crowd/i,
  /tráfico peatonal medido/i, /afluencia en tiempo real/i, /afluencia en vivo/i, /Datos reales de afluencia/,
  /实测/, /实时客流/, /实时人流/, /实时拥挤/,
];
const LANGS = ['', 'ko/', 'ja/', 'es/', 'zh/'];
// Two venues with a crowd chart, so one being retired someday does not fail the run.
const CHART_POSTS = ['aberdeen-tin-hau-temple-aberdeen', 'tokyo-shinjuku-gyoen-national-garden'];
const ASOF = /class="pcrowd-asof"/;

const visible = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ');

async function get(path) {
  const r = await fetch(`${BASE}/${path}?v=${Date.now()}`, { headers: { 'user-agent': 'Mozilla/5.0 (WanderAtlas live check)' } });
  return { status: r.status, html: r.status === 200 ? await r.text() : '' };
}

const { lag } = await deployLag();
let examined = 0;
for (const l of LANGS) {
  for (const page of ['', 'tools/best-time/', 'methodology/']) {
    const { status, html } = await get(`${l}${page}`);
    const hits = BANNED.filter((re) => re.test(visible(html))).map(String);
    if (status === 200) examined++;
    const bad = status !== 200 || hits.length > 0;
    if (bad && lag) { console.log(`WARN /${l}${page} — 배포 전(빌드가 최신 커밋보다 오래됨): ${status} ${hits.join(' ')}`); continue; }
    verdict(`${bad ? '✗' : '✓'} /${l}${page} ${status}${hits.length ? ` 금지어 ${hits.join(' ')}` : ''}`, bad);
  }
  let chartSeen = false;
  for (const slug of CHART_POSTS) {
    const { status, html } = await get(`${l}posts/${slug}/`);
    if (status !== 200 || !/besttime\.app/i.test(html)) continue;
    chartSeen = true;
    examined++;
    const hits = BANNED.filter((re) => re.test(visible(html))).map(String);
    const noDate = !ASOF.test(html);
    const bad = hits.length > 0 || noDate;
    if (bad && lag) { console.log(`WARN /${l}posts/${slug}/ — 배포 전: ${hits.join(' ')}${noDate ? ' 받은 날짜 없음' : ''}`); break; }
    verdict(`${bad ? '✗' : '✓'} /${l}posts/${slug}/${hits.length ? ` 금지어 ${hits.join(' ')}` : ''}${noDate ? ' — 그래프에 예측 받은 날짜가 없다' : ''}`, bad);
    break;
  }
  if (!chartSeen) verdict(`✗ ${l || 'en/'} 혼잡 그래프가 있는 글을 하나도 못 열었다(${CHART_POSTS.join(', ')}) — 검사할 수 없음`, true);
}
// Nothing examined is not a pass (scripts/audit-checkers.mjs contract).
if (examined === 0) verdict('✗ 한 페이지도 열지 못했다 — 통과가 아니다', true);
