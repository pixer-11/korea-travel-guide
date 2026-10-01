// Live check, ported from the hand-run mtfunc.mjs (scratchpad, week of 2026-09-28).
// Run: node scripts/live/my-trip.mjs [base]  — default base is the live site (lib.mjs).
// Functional checks for /my-trip, acting like a reader.   node mtfunc.mjs [base]
import { launch, BASE, verdict } from './lib.mjs';
const base = BASE;
const b = await launch();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const errs = [];
const newPage = async (ctx) => { const pg = await ctx.newPage(); pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errs.push(m.text())); return pg; };
const vis = (pg, sel) => pg.$$eval(sel, (els) => els.filter((e) => !e.closest('[hidden]') && getComputedStyle(e).display !== 'none').length);
const stored = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('wa_trip_v1') || '[]'));

const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'Asia/Seoul', permissions: ['clipboard-read', 'clipboard-write'] });
const pg = await newPage(ctx);
pg.on('dialog', (d) => d.accept());

// 1. Empty state
await pg.goto(base + '/ko/my-trip/', { waitUntil: 'networkidle' });
await pg.evaluate(() => localStorage.clear());
await pg.reload({ waitUntil: 'networkidle' });
ok(await vis(pg, '[data-empty-only]') >= 2 && await vis(pg, '[data-full-only]') === 0, 'empty state shows, full hidden');
await pg.waitForTimeout(1200);
ok((await pg.$$('.mt-start-card')).length === 6, 'first visit: six start places');
ok((await pg.$$('[data-pv-list] li')).length === 3, 'first visit: preview card three places');
ok(/바르셀로나/.test(await pg.$eval('[data-start-title]', (e) => e.textContent)), 'start city Barcelona');
// country chip switches the start city
const chips = await pg.$$('[data-start-rs]');
ok(chips.length >= 5, 'country chips');
const other = await pg.$$eval('[data-start-rs]', (bs) => bs.map((b) => b.dataset.startRs).find((r) => r !== 'barcelona'));
await pg.click(`[data-start-rs="${other}"]`);
await pg.waitForTimeout(1200);
ok(!/바르셀로나/.test(await pg.$eval('[data-start-title]', (e) => e.textContent)) && (await pg.$$('.mt-start-card')).length >= 1, `chip → ${other}`);
await pg.click('[data-start-rs="barcelona"]');
await pg.waitForTimeout(800);
// example trip: in memory only
await pg.click('[data-demo-start]');
await pg.waitForTimeout(800);
ok(await vis(pg, '[data-demo]') === 1 && (await pg.$$('.mt-item')).length === 4, 'example trip shows four places');
ok((await stored(pg)).length === 0, 'example trip stores nothing');
await pg.click('.mt-item [data-day-set="3"]');
ok((await stored(pg)).length === 0 && (await pg.$$('.mt-daybadge')).length === 4, 'editing the example stays in memory');
await pg.click('[data-demo-close]');
ok(await vis(pg, '[data-empty-only]') >= 2, 'closing the example → first visit again');
// heart on a start card saves for real
const heart = await pg.$('[data-start-save]');
const hs = await heart.getAttribute('data-start-save');
await heart.click();
await pg.waitForTimeout(800);
const sh = await stored(pg);
ok(sh.length === 1 && sh[0].slug === hs && sh[0].rs === 'barcelona', 'heart saves the place');
ok(await vis(pg, '[data-full-only]') >= 2, 'after the first save the trip view shows');
await pg.evaluate(() => localStorage.clear());
// example → save as my trip
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1000);
await pg.click('[data-demo-start]');
await pg.waitForTimeout(800);
await pg.click('[data-demo-save]');
ok((await stored(pg)).length === 4 && await vis(pg, '[data-demo]') === 0, 'example saved as my trip');
ok(await pg.$$eval('[data-nl]', (n) => n.length) === 1, 'one newsletter form on the page');
await pg.evaluate(() => localStorage.clear());
await pg.reload({ waitUntil: 'networkidle' });

// 2. Old saves are refreshed from the city file
const data = await (await fetch(`${base}/trip-data/ko/spain.json`)).json(); data.places = data.places.filter((p) => p.rs === 'barcelona');
const pick = ['casa-batllo', 'sagrada', 'park-guell', 'boqueria'].map((k) => data.places.find((p) => p.slug.includes(k))).filter(Boolean);
const old = pick.map((p) => ({ slug: p.slug, title: p.title, region: p.region, country: p.country, href: p.href, lat: p.lat, lng: p.lng, phone: p.phone, hours: p.hours, quiet: p.quiet, image: p.image }));
await pg.evaluate((v) => localStorage.setItem('wa_trip_v1', JSON.stringify(v)), old);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForTimeout(1500);
const s1 = await stored(pg);
ok(s1.length === pick.length && s1.every((i) => i.rs === 'barcelona' && 'week' in i && 'book' in i), 'old saves refreshed with rs/week/book');
ok((await pg.$$('.mt-item')).length === pick.length, 'cards rendered');
ok(/바르셀로나 \d+곳/.test(await pg.$eval('[data-headline]', (e) => e.textContent)), 'headline city + count');
ok(/^\d\d:\d\d$/.test(await pg.$eval('[data-clock-time]', (e) => e.textContent)), 'local clock');
ok(/7시간 느려요/.test(await pg.$eval('[data-clock-diff]', (e) => e.textContent)), 'Barcelona 7 h behind Seoul');
const counts = await pg.$$eval('[data-count]', (els) => els.map((e) => parseInt(e.textContent)));
ok(counts.reduce((a, c) => a + c, 0) <= pick.length && counts.every((n) => n >= 0), `open/soon/closed counts ${counts}`);
const statuses = await pg.$$eval('.mt-status', (els) => els.map((e) => e.textContent));
ok(statuses.length >= 3 && statuses.every((t) => /열어요|까지|영업|휴무|닫아요/.test(t)), `status labels ${statuses.join(' / ')}`);
const header = await pg.evaluate(() => document.querySelector('.site-header')?.innerText || '');
ok(header.includes(String(pick.length)), 'header badge shows count');

// 3. Assign a day
const first = s1[0].slug;
await pg.click(`[data-slug="${first}"] [data-day-set="2"]`);
const s2 = await stored(pg);
ok(s2.find((i) => i.slug === first).day === 2, 'day 2 stored');
ok((await pg.$eval(`[data-slug="${first}"] .mt-daybadge`, (e) => e.textContent)) === '2일', 'badge says 2일');
ok((await pg.$eval('[data-stat="planned"]', (e) => e.textContent)) === '1곳', 'planned stat 1');

// 4. By-day view + add a day
await pg.click('[data-view="days"]');
const heads = await pg.$$eval('.mt-day-head h3', (els) => els.map((e) => e.textContent));
ok(heads[0] === '2일차 · 1곳' && heads.some((h) => /날짜 미정/.test(h)), `day heads ${heads}`);
ok(await pg.$eval('.mt-day-head a', (a) => a.href.startsWith('https://www.google.com/maps/dir/')), 'day route link');
await pg.click('[data-addday]');
ok((await pg.$$(`[data-slug="${first}"] [data-day-set]`)).length === 5, 'add a day → 미정 + 4 days');
await pg.click('[data-view="list"]');

// 5. Filter book-ahead
await pg.click('[data-filter="book"]');
const nBook = s2.filter((i) => i.book).length;
ok((await pg.$$('.mt-item')).length === nBook, `book filter ${nBook}`);
await pg.click('[data-filter="all"]');

// 6. Address dialog
const withAddr = s2.find((i) => i.address);
if (withAddr) {
  await pg.click(`[data-addr="${withAddr.slug}"]`);
  ok(await pg.$eval('[data-addr-dialog]', (d) => d.open), 'address dialog opens');
  ok((await pg.$eval('[data-addr-text]', (e) => e.textContent)) === withAddr.address, 'dialog shows the address');
  await pg.click('[data-addr-close]');
  ok(!(await pg.$eval('[data-addr-dialog]', (d) => d.open)), 'dialog closes');
}

// 7. Save a nearby pick
const near = await pg.$$('[data-near-save]');
ok(near.length >= 1, 'nearby picks shown');
if (near.length) {
  const slug = await near[0].getAttribute('data-near-save');
  await near[0].click();
  const s3 = await stored(pg);
  ok(s3.some((i) => i.slug === slug && i.rs === 'barcelona' && 'week' in i), 'nearby pick saved with full payload');
  ok((await pg.$$('.mt-item')).length === s3.length, 'list grew');
}

// 8. Course + prep
ok(!(await pg.$eval('[data-course]', (e) => e.hidden)) && (await pg.$eval('[data-course]', (a) => a.getAttribute('href'))).includes('/itinerary/'), 'course card links an itinerary');
const prep = await pg.$$eval('.mt-prep a', (as) => as.map((a) => a.getAttribute('href')));
ok(prep.length === 4 && prep.every(Boolean), 'four prep links');

// 9. Share link round trip
await pg.click('[data-share]');
const url = await pg.evaluate(() => navigator.clipboard.readText());
ok(/#share=[\w-]+$/.test(url), 'share link copied');
const mine = await stored(pg);
const ctx2 = await b.newContext({ viewport: { width: 1300, height: 900 } });
const pg2 = await newPage(ctx2);
await pg2.goto(url.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'networkidle' });
ok(await pg2.$eval('[data-shared]', (e) => !e.hidden), 'share banner on the receiving side');
await pg2.click('[data-shared-add]');
await pg2.waitForTimeout(1500);
const got = await stored(pg2);
ok(got.length === mine.length && got.find((i) => i.slug === first)?.day === 2, `shared list imported with days (${got.length}/${mine.length})`);
ok(!/#share=/.test(pg2.url()), 'hash cleared after import');
await ctx2.close();

// 10. Remove + clear
const before = (await stored(pg)).length;
await pg.click(`[data-remove="${first}"]`);
ok((await stored(pg)).length === before - 1, 'remove one');
await pg.click('[data-clear]');
ok((await stored(pg)).length === 0 && await vis(pg, '[data-empty-only]') >= 2, 'clear → empty state');
await ctx.close();

// 11. Five languages on a phone, with a list
for (const lang of ['ko', 'en', 'ja', 'es', 'zh']) {
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' });
  const p = await newPage(c);
  const d = await (await fetch(`${base}/trip-data/${lang}/spain.json`)).json(); d.places = d.places.filter((p) => p.rs === 'barcelona');
  await p.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((v) => localStorage.setItem('wa_trip_v1', JSON.stringify(v)), d.places.slice(0, 5).map((x, i) => ({ ...x, day: i % 3 })));
  await p.goto(`${base}${lang === 'en' ? '' : '/' + lang}/my-trip/`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${lang} mobile no overflow`);
  const txt = await p.$eval('[data-mt]', (e) => e.innerText);
  ok(!/undefined|NaN|\[object|\{\w+\}/.test(txt), `${lang} no junk text`);
  await c.close();
}

verdict(`\n${pass} passed, ${fail} failed`, fail > 0 || errs.length > 0);
console.log('errors', errs.slice(0, 8));
await b.close();
