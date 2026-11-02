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
// 11-03: the first version read only the visible text of four pages. The live
// sweep after deploy found the same claim where it did not look — the crowd
// tool's meta description and WebApplication JSON-LD ("real crowd data" in five
// languages), the when-to-go pages ("Datos reales de afluencia", lower-case, so
// the case-sensitive pattern missed it), /tools/widget/ ("measured" ten times,
// partners' copy-paste snippet included), /api/ and /llms.txt. It now reads
// meta descriptions and JSON-LD too, covers those pages, and bans the words the
// translations actually use (medido, 측정, 計測), scoped to crowds.
//
// Run: node scripts/live/crowd-wording.mjs [base]
import { BASE, verdict, deployLag } from './lib.mjs';

// Words that claim live, measured or "real" crowds. Scoped to crowd wording:
// "real-time fares" on the flights page and "live prices" on eSIM pages are true
// and are not on these pages; the site-wide "facts checked against live data"
// line is about Google Places facts and is the owner's identity copy (08-08).
const BANNED = [
  /Live crowd data/i, /Live foot-traffic/i, /measured foot[- ]traffic/i, /Measured · by hour/, /measured hour by hour/i,
  /Outside measured hours/, /Live crowd widget/, /real crowd data/i, /real foot-traffic data/i, /Verified quiet times/i,
  /measured (?:crowd|quiet|busy|visitor|footfall)/i, /drop a live chart/i,
  /실측/, /실시간 방문자 데이터/, /실시간 인파/, /실시간 혼잡/, /실제 혼잡도 데이터/, /실제 방문자 데이터/,
  /측정[^.]{0,12}(?:방문|유동|인파|혼잡)/, /(?:방문객|방문자|유동 ?인구|인파|혼잡)[^.]{0,12}측정/,
  /実測/, /リアルタイム混雑/, /ライブ混雑/, /live foot-traffic forecasts/i, /embeddable live crowd/i, /実際の混雑データ/, /実際の人出データ/,
  /計測[^。]{0,12}(?:来訪|人出|混雑|人の流れ)/, /(?:来訪|人出|混雑|人の流れ)[^。]{0,12}計測/,
  /tráfico peatonal medido/i, /afluencia en tiempo real/i, /afluencia en vivo/i, /Datos reales de afluencia/i,
  // "datos de afluencia medidos", "patrón de afluencia medido" — not "a medida que".
  /\b(?:afluencia|datos|patr[oó]n(?:es)?|visitantes)\b[^.]{0,40}(?<!\ba )\bmedid[oa]s?\b/i,
  /实测/, /实时客流/, /实时人流/, /实时拥挤/, /真实人流/, /实际客流/, /不在统计时段/,
];
const LANGS = ['', 'ko/', 'ja/', 'es/', 'zh/'];
// Two venues with a crowd chart, so one being retired someday does not fail the run.
const CHART_POSTS = ['aberdeen-tin-hau-temple-aberdeen', 'tokyo-shinjuku-gyoen-national-garden'];
const ASOF = /class="pcrowd-asof"/;
// Pages in every language, and English-only pages. Japan's when-to-go page
// carries the quiet-hours card every country page renders.
const PAGES = ['', 'tools/best-time/', 'methodology/', 'tools/when-to-go/japan/'];
const EN_ONLY = ['tools/widget/', 'api/', 'llms.txt'];

// What a reader or a search engine is told: the visible text, the meta and
// social descriptions, and the JSON-LD (FAQ answers, the tool's description).
const told = (html) => {
  const metas = [...html.matchAll(/<meta\s[^>]*(?:name|property)="(?:description|og:description|twitter:description|og:title|twitter:title)"[^>]*>/gi)]
    .map((m) => (/content="([^"]*)"/i.exec(m[0]) || [])[1] || '');
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  // The crowd tool's labels ride in a JSON island the page script reads.
  const islands = [...html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return [visible, ...metas, ...ld, ...islands].join('\n');
};

async function get(path) {
  const r = await fetch(`${BASE}/${path}?v=${Date.now()}`, { headers: { 'user-agent': 'Mozilla/5.0 (WanderAtlas live check)' } });
  return { status: r.status, html: r.status === 200 ? await r.text() : '' };
}

const { lag } = await deployLag();
let examined = 0;
async function page(path) {
  const { status, html } = await get(path);
  const text = path.endsWith('.txt') ? html : told(html);
  const hits = BANNED.filter((re) => re.test(text)).map(String);
  if (status === 200) examined++;
  const bad = status !== 200 || hits.length > 0;
  if (bad && lag) { console.log(`WARN /${path} — 배포 전(빌드가 최신 커밋보다 오래됨): ${status} ${hits.join(' ')}`); return; }
  verdict(`${bad ? '✗' : '✓'} /${path} ${status}${hits.length ? ` 금지어 ${hits.join(' ')}` : ''}`, bad);
}
for (const l of LANGS) {
  for (const p of PAGES) await page(`${l}${p}`);
  let chartSeen = false;
  for (const slug of CHART_POSTS) {
    const { status, html } = await get(`${l}posts/${slug}/`);
    if (status !== 200 || !/besttime\.app/i.test(html)) continue;
    chartSeen = true;
    examined++;
    const hits = BANNED.filter((re) => re.test(told(html))).map(String);
    const noDate = !ASOF.test(html);
    const bad = hits.length > 0 || noDate;
    if (bad && lag) { console.log(`WARN /${l}posts/${slug}/ — 배포 전: ${hits.join(' ')}${noDate ? ' 받은 날짜 없음' : ''}`); break; }
    verdict(`${bad ? '✗' : '✓'} /${l}posts/${slug}/${hits.length ? ` 금지어 ${hits.join(' ')}` : ''}${noDate ? ' — 그래프에 예측 받은 날짜가 없다' : ''}`, bad);
    break;
  }
  if (!chartSeen) verdict(`✗ ${l || 'en/'} 혼잡 그래프가 있는 글을 하나도 못 열었다(${CHART_POSTS.join(', ')}) — 검사할 수 없음`, true);
}
for (const p of EN_ONLY) await page(p);
// Nothing examined is not a pass (scripts/audit-checkers.mjs contract).
if (examined === 0) verdict('✗ 한 페이지도 열지 못했다 — 통과가 아니다', true);
