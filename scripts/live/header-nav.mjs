// Live check: the header navigation (rewritten from the hand-run nav.mjs,
// 2026-10-01, after 4ea504704 put the essentials and tools dropdowns up top).
//  - desktop: one line at 1300 and 900 px; both dropdowns open on hover,
//    inside the viewport, with their links;
//  - phone: Essentials › and Tools › step down to their lists with nothing
//    else showing, and back;
//  - every link in the five languages' menus answers 200.
// Run: node scripts/live/header-nav.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const b = await launch();
const errs = [];
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails.push(msg); };

for (const [w, lang] of [[1300, 'ko'], [900, 'ko'], [1300, 'en'], [900, 'es'], [900, 'ja']]) {
  const pg = await b.newPage({ viewport: { width: w, height: 700 } });
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(`${BASE}${lang === 'en' ? '' : '/' + lang}/`, { waitUntil: 'networkidle' });
  const navH = await pg.$eval('.nav', (n) => n.getBoundingClientRect().height);
  check(navH < 60, `${lang} ${w}px header on one line (${Math.round(navH)}px)`);
  for (const [dd, min] of [['ess', 7], ['tools', 6]]) {
    await pg.hover(`[data-dd="${dd}"] .nav-dd-toggle`);
    await pg.waitForTimeout(400);
    const m = await pg.$eval(`[data-dd="${dd}"] .nav-dd-menu`, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, vis: getComputedStyle(e).visibility, n: e.querySelectorAll('a').length }; });
    check(m.vis === 'visible' && m.l >= 0 && m.r <= w && m.n >= min, `${lang} ${w}px ${dd} dropdown open, inside, ${m.n} links`);
  }
  await pg.close();
}

const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`${BASE}/ko/`, { waitUntil: 'networkidle' });
await pg.click('.menu-toggle');
await pg.waitForTimeout(400);
const top = await pg.$$eval('.nav > a, .nav .nav-drill[data-to]', (as) => as.filter((a) => a.offsetParent).length);
check(top >= 6, `phone top level shows ${top} rows`);
for (const [dd, min] of [['tools', 6], ['ess', 7]]) {
  await pg.click(`.nav-drill[data-to="${dd}"]`);
  await pg.waitForTimeout(300);
  const links = await pg.$$eval(`[data-dd="${dd}"] .nav-dd-menu a`, (as) => as.filter((a) => a.offsetParent).length);
  const strays = await pg.$$eval('.nav a, .nav button', (as, d) => as.filter((a) => a.offsetParent && !a.closest(`[data-dd="${d}"]`) && !a.classList.contains('nav-back')).length, dd);
  check(links >= min && strays === 0, `phone ${dd} list: ${links} links, ${strays} stray rows`);
  await pg.click('.nav-back');
  await pg.waitForTimeout(200);
}
await pg.close();

// Every menu link, five languages.
const hrefs = new Set();
for (const l of ['', '/ko', '/ja', '/es', '/zh']) {
  const html = await (await fetch(`${BASE}${l}/`)).text();
  const nav = html.slice(html.indexOf('id="site-nav"'), html.indexOf('</nav>', html.indexOf('id="site-nav"')));
  for (const m of nav.matchAll(/href="(\/[^"#]*)"/g)) hrefs.add(m[1]);
}
const dead = [];
for (const h of hrefs) { const r = await fetch(BASE + h, { redirect: 'manual' }); if (r.status !== 200) dead.push(`${r.status} ${h}`); }
check(hrefs.size > 50 && dead.length === 0, `${hrefs.size} menu links, ${dead.length} not 200 ${dead.slice(0, 5).join(', ')}`);

verdict(`\n${fails.length ? fails.length + ' failed' : 'all passed'} · errors ${errs.length}`, fails.length > 0 || errs.length > 0);
await b.close();
