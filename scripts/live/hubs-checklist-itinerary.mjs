// Live check, ported from the hand-run func.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/hubs-checklist-itinerary.mjs [base]  — default base is the live site (lib.mjs).
// Functional verification of everything redesigned on 2026-09-30, against a
// base URL (dev server or live). Every check prints PASS/FAIL with a reason;
// the run ends with a summary and the list of failures.
//   node func.mjs https://wanderatlasguides.com
import { launch, BASE, verdict } from './lib.mjs';

const results = [];
const ok = (name, cond, info = '') => { results.push({ name, pass: !!cond, info }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } });
const errors = new Map();
async function open(path, width) {
  const p = await ctx.newPage();
  if (width) await p.setViewportSize({ width, height: 850 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(plausible|googletag)/i.test(m.text())) errs.push(m.text()); });
  const r = await p.goto(BASE + path, { waitUntil: 'networkidle', timeout: 180000 });
  errors.set(path, errs);
  return { p, status: r.status(), errs };
}
const links = new Set();
async function collectLinks(p) {
  for (const h of await p.evaluate(() => [...document.querySelectorAll('main a[href]')].map((a) => a.getAttribute('href')))) {
    if (h && h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/go/')) links.add(h.split('#')[0]);
  }
}

// ── 1. Events hub ──
{
  const { p, status, errs } = await open('/ko/events/');
  ok('events: 200', status === 200);
  const picks = await p.$$eval('.evp-card', (x) => x.length);
  ok('events: 3 picks', picks === 3, `picks=${picks}`);
  const stats = await p.$$eval('[data-stat]', (x) => x.map((e) => Number(e.textContent)));
  ok('events: stats are numbers', stats.length === 3 && stats.every((n) => Number.isFinite(n)), stats.join('/'));
  const firstMonth = await p.$eval('button[data-month]:not([data-month="all"])', (e) => e.dataset.month);
  await p.click(`button[data-month="${firstMonth}"]`);
  const visibleGroups = await p.$$eval('[data-ev-group]:not([hidden])', (x) => x.map((g) => g.dataset.month));
  ok('events: month tab shows only that month', visibleGroups.length === 1 && visibleGroups[0] === firstMonth, visibleGroups.join(','));
  ok('events: hash records month', (await p.evaluate(() => location.hash)).includes(`m=${firstMonth}`));
  await p.click('button[data-month="all"]');
  const cat = await p.$eval('button[data-filter]:not([data-filter="all"])', (e) => e.dataset.filter);
  await p.click(`button[data-filter="${cat}"]`);
  const wrong = await p.$$eval('[data-ev-group] [data-category]:not([hidden])', (x, c) => x.filter((e) => e.dataset.category !== c).length, cat);
  ok('events: category chip filters rows', wrong === 0, `cat=${cat}`);
  await p.click('button[data-filter="all"]');
  const fold = await p.$('[data-ev-more]');
  if (fold) { await fold.evaluate((d) => { d.open = true; }); await p.evaluate(() => { location.hash = 'past-events'; }); await p.waitForTimeout(200);
    ok('events: opened fold survives hash change', await fold.evaluate((d) => d.open)); }
  ok('events: past archive opens from its link', await p.$eval('#past-events', (d) => d.open));
  ok('events: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await collectLinks(p); await p.close();
}
{
  const { p, status, errs } = await open('/ko/events/japan/');
  ok('events/japan: 200 + hero note', status === 200 && (await p.$('.evh-note')) !== null);
  ok('events/japan: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await collectLinks(p); await p.close();
}

// ── 2. Essentials hub ──
{
  const { p, status, errs } = await open('/ko/essentials/');
  ok('ess hub: 200', status === 200);
  await p.fill('[data-exh-q]', '베트');
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok('ess hub: search → Vietnam panel', (await p.$eval('[data-exh-panel]:not([hidden])', (e) => e.dataset.exhPanel)) === 'vietnam');
  await p.click('[data-exh-tab="france"]');
  ok('ess hub: tab → France', (await p.$eval('[data-exh-panel]:not([hidden])', (e) => e.dataset.exhPanel)) === 'france');
  const tz = await p.$eval('[data-exh-panel]:not([hidden]) [data-exh-diff]', (e) => e.textContent);
  ok('ess hub: time cell computed', tz && tz !== '—', tz);
  await p.fill('[data-exh-q]', ''); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok('ess hub: empty Enter stays on page', p.url().includes('/ko/essentials/') && !p.url().includes('south-korea'));
  await p.focus('[data-exh-q]'); await p.waitForTimeout(100);
  await p.focus('[data-exh-tab="france"]'); await p.waitForTimeout(100);
  ok('ess hub: suggestions close when focus leaves', await p.$eval('[data-exh-suggest]', (e) => e.hidden));
  ok('ess hub: FAQ JSON-LD', await p.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => s.textContent.includes('FAQPage'))));
  ok('ess hub: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await collectLinks(p); await p.close();
}

// ── 3. Essentials country page ──
{
  const { p, status, errs } = await open('/ko/essentials/japan/');
  ok('ess japan: 200 + cards', status === 200 && (await p.$$eval('.ess-sum', (x) => x.length)) >= 3);
  const missing = await p.$$eval('.ess-toc a[href^="#"]', (as) => as.map((a) => a.getAttribute('href')).filter((h) => !document.querySelector(h)));
  ok('ess japan: every contents link has a target', missing.length === 0, missing.join(','));
  ok('ess japan: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await collectLinks(p); await p.close();
}

// ── 4. Checklist ──
{
  const { p, status, errs } = await open('/ko/free/trip-checklist/');
  await p.evaluate(() => localStorage.removeItem('wa-trip-checklist-v1'));
  await p.reload({ waitUntil: 'networkidle' });
  ok('checklist: 200', status === 200);
  await p.click('[data-ck-open="date"]');
  ok('checklist: calendar opens', !(await p.$eval('[data-ck-pop="date"]', (e) => e.hidden)));
  ok('checklist: past days disabled', (await p.$$eval('.ck-cal-grid button:disabled', (x) => x.length)) >= 0);
  await p.click('[data-ck-month="1"]'); await p.click('[data-ck-month="1"]');
  await p.click('.ck-cal-grid button:has-text("15")');
  const by = await p.$$eval('[data-ck-by]', (x) => x.map((e) => e.textContent));
  ok('checklist: deadlines filled', by.every((t) => /\d+\/\d+/.test(t)), by.join(' | '));
  await p.click('[data-ck-open="dest"]'); await p.fill('[data-ck-dest-search]', '태국'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const sc = await p.$$eval('[data-ck-shortcut-list] a', (x) => x.map((a) => a.getAttribute('href')));
  ok('checklist: country shortcuts', sc.length >= 3, sc.length + ' links');
  sc.forEach((h) => links.add(h.split('?')[0]));
  await p.click('label.ck-item >> nth=0');
  await p.reload({ waitUntil: 'networkidle' });
  ok('checklist: state persists', (await p.$eval('[data-ck-dest-text]', (e) => e.textContent)) === '태국' && (await p.$eval('input[data-ck-id="0-0"]', (e) => e.checked)));
  await p.emulateMedia({ media: 'print' });
  const pdf = await p.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm' } });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok('checklist: prints as 2 A4 pages', pages === 2, `pages=${pages}`);
  ok('checklist: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await p.evaluate(() => localStorage.removeItem('wa-trip-checklist-v1'));
  await p.close();
}

// ── 5. Itinerary hub ──
{
  const { p, status, errs } = await open('/ko/itinerary/');
  ok('itin hub: 200', status === 200);
  const all = await p.$$eval('[data-city-card]', (x) => x.length);
  await p.click('input[name=days][value="5"] + span');
  const five = await p.$$eval('[data-city-card]:not([hidden])', (x) => x.map((c) => c.dataset.days));
  ok('itin hub: 5-day filter', five.length > 0 && five.every((d) => d.split(',').includes('5')), `${five.length}/${all}`);
  const shown5 = await p.$$eval('[data-city-card]:not([hidden]) [data-course]:not([hidden])', (x) => x.map((c) => c.dataset.course));
  ok('itin hub: cards switch to their 5-day course', shown5.every((d) => d === '5'));
  await p.click('input[name=days][value=""] + span');
  await p.click('input[name=cat][value=views] + span');
  const views = await p.$$eval('[data-city-card]:not([hidden])', (x) => x.map((c) => c.dataset.name));
  ok('itin hub: views filter includes Tokyo', views.some((n) => /도쿄/.test(n)), views.join(','));
  await p.selectOption('[data-ixh-sort]', 'stops');
  const stops = await p.$$eval('[data-city-card]', (x) => x.map((c) => Number(c.dataset.stops)));
  ok('itin hub: sort by stops', stops.every((n, i) => i === 0 || stops[i - 1] >= n));
  ok('itin hub: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await collectLinks(p); await p.close();
}

// ── 6. Itinerary page (Barcelona) ──
{
  const { p, status, errs } = await open('/ko/itinerary/barcelona-3-days/');
  ok('itin bcn: 200', status === 200);
  ok('itin bcn: 4 stats', (await p.$$eval('.ith-stats > div', (x) => x.length)) === 4);
  await p.fill('#itin-arrival', '2026-10-16'); await p.dispatchEvent('#itin-arrival', 'change'); await p.waitForTimeout(400);
  const clash = await p.$eval('[data-itin-clash-text]', (e) => e.textContent);
  ok('itin bcn: clash names La Boqueria on day 3', /3일차/.test(clash) && /보케리아/.test(clash), clash.slice(0, 60));
  ok('itin bcn: day-3 tab dot', !(await p.$eval('[data-day-tab="2"] [data-tab-dot]', (e) => e.hidden)));
  const ics = await p.$$eval('[data-ics-link]:not([hidden])', (x) => x.map((a) => a.getAttribute('href') || ''));
  ok('itin bcn: calendar files offered for 3 days', ics.length === 3 && ics.every((h) => h.startsWith('data:text/calendar') || h.startsWith('blob:')), `${ics.length} ${ics[0]?.slice(0, 30)}`);
  const closedChip = await p.$$eval('.chip-closed', (x) => x.map((c) => c.textContent));
  ok('itin bcn: closed chip turns into a warning', closedChip.some((t) => /⚠/.test(t)));
  // older filters still work
  await p.click('.ith-more > summary');
  const paceRadio = await p.$('input[name=pace][value=relaxed]');
  if (paceRadio) { await paceRadio.check(); await p.waitForTimeout(300);
    ok('itin bcn: relaxed pace hides a stop', (await p.$$eval('.itin-stop[hidden]', (x) => x.length)) > 0);
    await p.check('input[name=pace][value=normal]'); }
  await p.check('input[name=interest][value=culture]'); await p.waitForTimeout(200);
  ok('itin bcn: interest filter marks stops', (await p.$$eval('.itin-stop', (x) => x.filter((s) => s.className.match(/dim|match|highlight/) || s.style.opacity).length)) >= 0);
  ok('itin bcn: hash keeps choices', /d=2026-10-16/.test(await p.evaluate(() => location.hash)));
  await p.click('[data-itin-rain]');
  ok('itin bcn: rainy-day view toggles', await p.$eval('[data-itin-page]', (e) => e.classList.contains('is-rain')));
  await p.click('.ith-book label >> nth=0'); await p.reload({ waitUntil: 'networkidle' });
  ok('itin bcn: book checklist persists', /1\/5/.test(await p.$eval('[data-book-count-text]', (e) => e.textContent)));
  ok('itin bcn: arrival restored from hash', (await p.$eval('#itin-arrival', (e) => e.value)) === '2026-10-16');
  const dirs = await p.$$eval('a.itin-leg-directions', (x) => x.map((a) => a.href));
  ok('itin bcn: directions links are Google Maps routes', dirs.length > 0 && dirs.every((h) => /google\.com\/maps\/dir\/\?api=1&origin=[-\d.]+,[-\d.]+&destination=[-\d.]+,[-\d.]+/.test(h)), `${dirs.length}`);
  await p.emulateMedia({ media: 'print' });
  ok('itin bcn: print hides bar and sidebar', await p.evaluate(() => ['.ith-bar', '.ith-side'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none')));
  await p.evaluate(() => localStorage.clear());
  ok('itin bcn: no JS errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await collectLinks(p); await p.close();
}

// ── 7. Mobile smoke: every redesigned page at 390px ──
for (const path of ['/ko/events/', '/ko/essentials/', '/ko/essentials/vietnam/', '/ko/free/trip-checklist/', '/ko/itinerary/', '/ko/itinerary/tokyo-5-days/', '/ja/itinerary/barcelona-3-days/']) {
  const { p, status, errs } = await open(path, 390);
  const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  ok(`mobile ${path}: 200, no overflow, no errors`, status === 200 && !over && errs.length === 0, `${status} over=${over} ${errs[0] ?? ''}`);
  await p.close();
}

// ── 8. Every internal link found on those pages answers 200 ──
const bad = [];
for (const h of links) {
  const r = await ctx.request.get(BASE + h, { maxRedirects: 3 }).catch(() => null);
  if (!r || r.status() >= 400) bad.push(`${h} → ${r ? r.status() : 'error'}`);
}
ok(`links: ${links.size} internal links all open`, bad.length === 0, bad.slice(0, 6).join(', '));

await b.close();
const fails = results.filter((r) => !r.pass);
verdict(`\n${results.length - fails.length}/${results.length} passed`, fails.length > 0);
for (const f of fails) console.log(`  FAIL ${f.name} ${f.info}`);
