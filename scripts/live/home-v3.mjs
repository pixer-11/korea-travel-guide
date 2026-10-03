// Live check: the v3 home page (2026-10-04, owner's "Home v3" mock-up, kept
// with the photo wall and per-country photos).
//  - the wall's tiles link to guides (real places, not decoration);
//  - the three hero tabs switch; the month picker shows countries; picking
//    Japan + April gives Japan's April when-to-go page and Japan's shortcuts;
//  - the stats strip carries numbers, the Korean and Japanese homes list a
//    long weekend that has not ended by the reader's date;
//  - every link the hero and the country list print answers 200;
//  - no page error, no sideways scroll at 320px, in all five languages.
// Run: node scripts/live/home-v3.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const b = await launch();
const errs = [];
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };
const hrefs = new Set();

for (const lang of ['en', 'ko', 'ja', 'es', 'zh']) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', (e) => errs.push(`${lang}: ${e.message}`));
  await pg.goto(`${BASE}${lang === 'en' ? '' : '/' + lang}/`, { waitUntil: 'networkidle' });
  const r = await pg.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null;
    const q = (s) => document.querySelector(s);
    const pills = () => [...document.querySelectorAll('[data-month-pills] .hv3-pill')].filter(vis);
    const out = { wall: document.querySelectorAll('.wall-tile[href*="/posts/"]:not([tabindex])').length, pills: pills().length };
    q('[data-months] [data-m="1"]').click();
    out.janHref = pills()[0]?.getAttribute('href') || '';
    q('[data-tab="1"]').click();
    out.tab = vis(q('#hv3-p1')) && !vis(q('#hv3-p0'));
    const sel = q('#hv3-p1 [data-country]');
    sel.value = 'japan'; sel.dispatchEvent(new Event('change'));
    const ms = q('[data-month]'); ms.value = '4'; ms.dispatchEvent(new Event('change'));
    out.more = q('[data-v-more]').getAttribute('href');
    out.head = q('[data-v-head]').textContent;
    out.esim = q('#hv3-p1 [data-k="esim"]').getAttribute('href');
    out.stats = [...document.querySelectorAll('.hv3-stats dt')].map((d) => Number(d.textContent.replace(/[^\d]/g, '')));
    out.hol = [...document.querySelectorAll('[data-hol] li')].filter(vis).length;
    out.links = [...document.querySelectorAll('.hv3 a[href^="/"], .hv3-countries a[href^="/"], .hv3-hol a[href^="/"]')].map((a) => a.getAttribute('href'));
    return out;
  });
  r.links.forEach((h) => hrefs.add(h.split('#')[0]));
  check(r.wall >= 10, `${lang} wall: ${r.wall} tiles link to guides`);
  check(r.pills >= 3, `${lang} month picker shows ${r.pills} countries`);
  check(/\/tools\/when-to-go\/[a-z-]+\/january\/$/.test(r.janHref), `${lang} January pick links ${r.janHref}`);
  check(r.tab, `${lang} tabs switch`);
  check(/\/tools\/when-to-go\/japan\/april\/$/.test(r.more) && r.head.length > 3, `${lang} Japan in April → ${r.more} "${r.head}"`);
  check(/\/tools\/esim\/japan\/$/.test(r.esim), `${lang} Japan eSIM shortcut ${r.esim}`);
  check(r.stats.length === 3 && r.stats.every((n) => Number.isFinite(n)) && r.stats[2] > 100, `${lang} stats ${r.stats.join('/')}`);
  if (lang === 'ko' || lang === 'ja') check(r.hol >= 1, `${lang} ${r.hol} upcoming long weekends`);
  await pg.close();

  const ph = await b.newPage({ viewport: { width: 320, height: 700 } });
  ph.on('pageerror', (e) => errs.push(`${lang} 320: ${e.message}`));
  await ph.goto(`${BASE}${lang === 'en' ? '' : '/' + lang}/`, { waitUntil: 'networkidle' });
  const over = await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(over <= 0, `${lang} 320px no sideways scroll (${over})`);
  await ph.close();
}

const dead = [];
for (const h of hrefs) { const r = await fetch(BASE + h, { redirect: 'manual' }); if (r.status !== 200) dead.push(`${r.status} ${h}`); }
check(hrefs.size > 100 && dead.length === 0, `${hrefs.size} hero/country links, ${dead.length} not 200 ${dead.slice(0, 5).join(', ')}`);

verdict(`\n${fails.length ? fails.length + ' failed' : 'all passed'} · errors ${errs.length} ${errs.slice(0, 3).join(' | ')}`, fails.length > 0 || errs.length > 0);
await b.close();
