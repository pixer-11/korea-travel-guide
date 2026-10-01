// Live check: the events hubs' "on now" section, by rules that hold on any day
// (rewritten from the hand-run endtest3.mjs, 2026-10-01).
//  - the hero's "on now" number equals the section's count (the reader-date
//    script moves started rows in and ended cards out — f28650a85);
//  - no visible card or row says "ended" (17f8538a7);
//  - no page errors.
// Pages: the global hub in five languages plus every country hub /events/ links.
// Run: node scripts/live/events-now.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';

const ENDED = /^(Ended|종료|終了|Terminado|已结束)$/;
const b = await launch();
const pg = await b.newPage({ viewport: { width: 1375, height: 900 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(`${pg.url()} ${e.message}`));
pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`${pg.url()} ${m.text()}`); });

await pg.goto(`${BASE}/events/`, { waitUntil: 'networkidle' });
// The global hub lists the country hubs in its foot (EventsFoot); the chip row
// in the list carries them only on some pages. Seeing none is a failure.
const countries = [...new Set(await pg.$$eval('.evf-countries a, a.ev-chip--link', (as) => as.map((a) => new URL(a.href).pathname)))];
if (countries.length < 3) { console.log(`✗ found only ${countries.length} country hub links on /events/`); process.exitCode = 1; }
const paths = ['/events/', '/ko/events/', '/ja/events/', '/es/events/', '/zh/events/', ...countries.slice(0, 8)];

let bad = 0;
for (const path of paths) {
  const r0 = await pg.goto(BASE + path, { waitUntil: 'networkidle' });
  const r = await pg.evaluate((endedSrc) => {
    const ended = new RegExp(endedSrc);
    const vis = (el) => el && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]');
    const hero = Number(document.querySelector('[data-stat="now"]')?.textContent ?? NaN);
    const sec = document.querySelector('.ev-now');
    const shown = vis(sec);
    const sub = sec?.querySelector('[data-now-sub]')?.textContent ?? '';
    const n = shown ? Number((sub.match(/\d+/) || ['0'])[0]) : 0;
    const endedShown = sec ? [...sec.querySelectorAll('[data-left]')].filter((x) => vis(x) && ended.test(x.textContent.trim())).length : 0;
    // Each month fold says how many rows it holds (Codex C4).
    const foldOff = [...document.querySelectorAll('[data-ev-more]')].filter((d) => !d.hidden).filter((d) => {
      const said = Number((d.querySelector('.ev-more-t')?.textContent.match(/\d+/) || ['-1'])[0]);
      return said !== d.querySelectorAll('li[data-category]:not([data-over])').length;
    }).length;
    // With no filter on, the "nothing of this kind" note stays away (Codex C6).
    const noneShown = !location.hash.includes('=') && vis(document.querySelector('[data-ev-none]'));
    return { hero, shown, n, endedShown, foldOff, noneShown };
  }, ENDED.source);
  const problems = [];
  if (r0.status() !== 200) problems.push(`status ${r0.status()}`);
  if (Number.isFinite(r.hero) && r.hero !== r.n) problems.push(`hero ${r.hero} ≠ list ${r.n}`);
  if (r.endedShown) problems.push(`${r.endedShown} ended card(s) visible`);
  if (r.foldOff) problems.push(`${r.foldOff} month fold(s) miscount their rows`);
  if (r.noneShown) problems.push('"no events" note shown with no filter on');
  if (problems.length) bad++;
  console.log(`${problems.length ? '✗' : '✓'} ${path} on-now ${r.n}${problems.length ? ' — ' + problems.join('; ') : ''}`);
}
verdict(`\n${paths.length - bad}/${paths.length} hubs passed · errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`, bad > 0 || errs.length > 0);
await b.close();
