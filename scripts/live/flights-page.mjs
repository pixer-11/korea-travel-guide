// Live check: the flights page (redesigned 2026-10-08 from the "항공권 개선안"
// mock).
//  - five languages: destination chips and month strips render; the default
//    departure city is the language's home (ko=SEL, ja=TYO) and none elsewhere;
//  - a chip reloads the search widget with that destination and opens that
//    destination's year (and only that one);
//  - no fare number anywhere on the page (the mock's placeholder prices were
//    left out on purpose — this site never prints a price it did not measure);
//  - every internal link on the page answers 200; the pickup link keeps the
//    marker short link and rel="sponsored";
//  - no horizontal scroll on a phone.
// Run: node scripts/live/flights-page.mjs [base]
import { launch, BASE, verdict, ROOT } from './lib.mjs';
import { execSync } from 'node:child_process';

// Not deployed yet is not broken. The 00:52 KST run on 2026-10-09 failed all
// five languages because the redesign, committed at 23:57, was still in the
// build queue — the live page was the old one. When the live build predates
// the last change to the page or this check, say so and stop.
{
  const [, liveAt] = (await (await fetch(`${BASE}/build.txt?t=${Date.now()}`)).text()).trim().split(/\s+/);
  let pageAt = NaN;
  try { pageAt = Number(execSync('git log -1 --format=%ct -- src/components/FlightsPage.astro scripts/live/flights-page.mjs', { cwd: ROOT }).toString().trim()); } catch {}
  // Six hours at most: a deploy stuck for longer is a failure worth hearing about.
  if (Number.isFinite(Number(liveAt)) && Number.isFinite(pageAt) && Number(liveAt) < pageAt && Date.now() / 1000 - pageAt < 6 * 3600) {
    console.log(`⚠ the flights page change (${new Date(pageAt * 1000).toISOString()}) is not live yet (build ${new Date(Number(liveAt) * 1000).toISOString()}) — skipped, not failed`);
    process.exit(0);
  }
}

const b = await launch();
const errs = [];
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };

const ORIGIN = { en: '', ko: 'SEL', ja: 'TYO', es: '', zh: '' };
const hrefs = new Set();
for (const lang of Object.keys(ORIGIN)) {
  const path = `${lang === 'en' ? '' : '/' + lang}/flights/`;
  const html = await (await fetch(BASE + path)).text();
  const chips = (html.match(/class="fl-chip"/g) || []).length;
  const years = (html.match(/class="fl-year"/g) || []).length;
  check(chips >= 8 && years >= 8, `${lang} ${chips} destination chips, ${years} month strips`);
  const src = html.match(/data-src="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&') ?? '';
  const o = new URL(src || 'https://x/').searchParams.get('origin') ?? '';
  check(o === ORIGIN[lang], `${lang} default origin "${o}" (want "${ORIGIN[lang]}")`);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const text = main.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const price = text.match(/[$₩¥€£]\s?\d|[1-9][\d,.]*\s?(?:원|円|元|€|USD|EUR|KRW|JPY|dólares)|\d+만원/); // "0원" (no markup) is not a fare
  check(!price, `${lang} prints no fare${price ? ` — found "${price[0]}"` : ''}`);
  check(/kiwitaxi\.tpx\.lv\/yRbl5tIp/.test(html) && /rel="sponsored noopener"/.test(html), `${lang} pickup partner link intact`);
  for (const m of main.matchAll(/href="(\/[^"#]*)"/g)) hrefs.add(m[1]);
}
const dead = [];
for (const h of hrefs) { const r = await fetch(BASE + h, { redirect: 'manual' }); if (r.status !== 200) dead.push(`${r.status} ${h}`); }
check(hrefs.size > 40 && dead.length === 0, `${hrefs.size} page links, ${dead.length} not 200 ${dead.slice(0, 5).join(', ')}`);

// A chip loads that destination into the widget and opens only its year.
const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/ko/flights/`, { waitUntil: 'networkidle' });
await pg.click('.fl-chip[data-code="BKK"]');
await pg.waitForTimeout(500);
const st = await pg.evaluate(() => ({
  src: document.querySelector('#fl-widget script')?.getAttribute('src') ?? '',
  open: [...document.querySelectorAll('.fl-year')].filter((y) => !y.hidden).map((y) => y.dataset.for),
}));
check(/destination=BKK/.test(st.src) && /origin=SEL/.test(st.src), `chip → widget ${st.src.match(/(origin|destination)=\w+/g)?.join(' ')}`);
check(st.open.length === 1 && st.open[0] === 'BKK', `chip opens only its year (${st.open.join(',')})`);
await pg.close();

const ph = await b.newPage({ viewport: { width: 375, height: 812 } });
ph.on('pageerror', (e) => errs.push(e.message));
await ph.goto(`${BASE}/ja/flights/`, { waitUntil: 'networkidle' });
const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
check(sw <= 376, `phone no horizontal scroll (${sw}px)`);
await ph.close();
await b.close();

verdict(`\n${fails.length ? fails.length + ' failed' : 'all passed'} · errors ${errs.length}`, fails.length > 0 || errs.length > 0);
